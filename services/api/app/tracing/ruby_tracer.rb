# Ruby step-through tracer via TracePoint. Reads one JSON job on STDIN,
# evals the student source with tracing enabled, emits the shared Prizm
# event schema as one JSON document on the real STDOUT.
#
# Only lines/methods defined in the student file are traced — stdlib noise
# is filtered by source path, so `puts "hi"` shows as output, not steps.

require 'json'
require 'stringio'

raw_stdin = STDIN.read
job = begin
  JSON.parse(raw_stdin.nil? || raw_stdin.empty? ? '{}' : raw_stdin)
rescue StandardError
  {}
end
source = job['source'].to_s
stdin_data = job['stdin'].to_s

real_stdout = STDOUT
captured_out = StringIO.new
$stdout = captured_out
$stdin = StringIO.new(stdin_data)

TRACE_FILE = '(prizm-student)'.freeze
MAX_EVENTS = 2000
TIME_BUDGET = 3.0

events = []
frame_stack = [{ id: 'f0', name: '<main>' }]
status = 'ok'
error = nil
raised = nil
started = Time.now

# Runs student code in THIS method's binding so its locals are exactly the
# student's own (plus the two prizm_* params we filter out) — the tracer's
# top-level locals never leak into the variable inspector, and a student
# variable named `events` or `status` cannot clobber the tracer.
def prizm_run_eval(prizm_code, prizm_file)
  eval(prizm_code, binding, prizm_file)
end

def prizm_serialize(value, depth = 0)
  case value
  when nil then { 'type' => 'null', 'value' => nil }
  when Integer, Float then { 'type' => 'number', 'value' => value }
  when String then { 'type' => 'string', 'value' => value[0, 160] }
  when true, false then { 'type' => 'boolean', 'value' => value }
  when Array
    if depth >= 3
      { 'type' => 'object', 'id' => 'Array', 'label' => "[... #{value.size} items]" }
    else
      { 'type' => 'array', 'value' => value.first(8).map { |v| prizm_serialize(v, depth + 1) } }
    end
  when Hash
    label = value.inspect[0, 150]
    { 'type' => 'object', 'id' => 'Hash', 'label' => label }
  when Proc then { 'type' => 'function', 'name' => (value.source_location ? value.source_location.join(':') : 'proc') }
  when Method then { 'type' => 'function', 'name' => value.name.to_s }
  when Symbol then { 'type' => 'string', 'value' => value.inspect[0, 160] }
  else
    { 'type' => 'object', 'id' => value.class.name.to_s, 'label' => value.inspect[0, 160] }
  end
rescue StandardError
  { 'type' => 'object', 'id' => 'Unknown', 'label' => value.class.name.to_s }
end

def prizm_locals(binding_obj)
  locals = {}
  binding_obj.local_variables.each do |name|
    next if name.to_s.start_with?('prizm')
    locals[name.to_s] = prizm_serialize(binding_obj.local_variable_get(name))
  rescue StandardError
    locals[name.to_s] = { 'type' => 'object', 'id' => 'Unreadable', 'label' => '?' }
  end
  locals
end

def prizm_push(events, kind, line, name, locals, value, frame_stack)
  frame = frame_stack.last
  events << {
    'step' => events.length + 1,
    'event' => kind,
    'line' => line,
    'functionName' => name,
    'frameId' => frame[:id],
    'parentFrameId' => frame_stack.size > 1 ? frame_stack[-2][:id] : nil,
    'locals' => locals,
    'output' => '',
    'value' => value,
    'exception' => nil
  }
end

trace = TracePoint.new(:call, :return, :line, :raise) do |tp|
  next unless tp.path == TRACE_FILE

  if events.length >= MAX_EVENTS
    status = 'event_limit'
    trace.disable
    next
  end
  if Time.now - started > TIME_BUDGET
    status = 'timeout'
    trace.disable
    next
  end

  case tp.event
  when :call
    frame_id = "f#{events.length + 1}"
    frame_stack << { id: frame_id, name: tp.method_id.to_s }
    locals = {}
    begin
      locals = prizm_locals(tp.binding)
    rescue StandardError
      locals = {}
    end
    prizm_push(events, 'call', tp.lineno, tp.method_id.to_s, locals, nil, frame_stack)
  when :return
    locals = {}
    value = nil
    begin
      locals = prizm_locals(tp.binding)
      value = prizm_serialize(tp.return_value)
    rescue StandardError
      nil
    end
    prizm_push(events, 'return', tp.lineno, tp.method_id.to_s, locals, value, frame_stack)
    frame_stack.pop if frame_stack.size > 1
  when :line
    locals = {}
    begin
      locals = prizm_locals(tp.binding)
    rescue StandardError
      locals = {}
    end
    name = frame_stack.last[:name]
    prizm_push(events, 'line', tp.lineno, name, locals, nil, frame_stack)
  when :raise
    raised = "#{tp.raised_exception.class}: #{tp.raised_exception.message}"
  end
end

begin
  trace.enable
  prizm_run_eval(source, TRACE_FILE)
rescue SystemExit
  # student called exit — normal termination
rescue Exception => e
  raised ||= "#{e.class}: #{e.message}"
ensure
  trace.disable
end

status = 'error' if status == 'ok' && raised
$stdout = real_stdout

if captured_out.string.length > 0
  events << {
    'step' => events.length + 1,
    'event' => 'line',
    'line' => events.last ? events.last['line'] : 1,
    'functionName' => '<output>',
    'frameId' => 'f0',
    'parentFrameId' => nil,
    'locals' => {},
    'output' => captured_out.string,
    'value' => nil,
    'exception' => nil
  }
end

error_payload =
  if status == 'error' && raised
    parts = raised.split(': ', 2)
    { 'type' => parts[0] || 'RuntimeError', 'message' => parts[1] || raised }
  elsif status == 'timeout'
    { 'type' => 'TimeoutError', 'message' => "Ruby trace exceeded #{TIME_BUDGET}s and was stopped." }
  elsif status == 'event_limit'
    { 'type' => 'EventLimit', 'message' => "Stopped after #{MAX_EVENTS} events." }
  end

real_stdout.write(JSON.generate({
  'status' => status,
  'events' => events,
  'output' => events.map { |e| e['output'] }.join,
  'error' => error_payload
}))
