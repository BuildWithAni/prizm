import com.sun.jdi.Bootstrap;
import com.sun.jdi.LocalVariable;
import com.sun.jdi.StackFrame;
import com.sun.jdi.Value;
import com.sun.jdi.VirtualMachine;
import com.sun.jdi.connect.Connector;
import com.sun.jdi.connect.LaunchingConnector;
import com.sun.jdi.event.Event;
import com.sun.jdi.event.EventSet;
import com.sun.jdi.event.MethodEntryEvent;
import com.sun.jdi.event.VMDeathEvent;
import com.sun.jdi.event.VMDisconnectEvent;
import com.sun.jdi.request.MethodEntryRequest;
import com.sun.jdi.request.StepRequest;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.io.ByteArrayOutputStream;

/** Small JDI driver that emits the shared Prizm event schema as JSON.

 * Call/return events are derived from contiguous *student* frame depth
 * changes between recorded line stops (same model as the GDB tracer), so
 * Java and Kotlin get a real call-stack ladder without MethodExit requests. */
public final class JavaTraceDriver {
  private static final StringBuilder OUT = new StringBuilder();
  private static final Map<Integer, String> FRAME_IDS = new HashMap<>();
  private static final Map<Integer, String> METHOD_AT_DEPTH = new HashMap<>();
  private static int step = 0;
  private static int prevStudentDepth = -1;
  private static String mainClass = "Main";
  private static long started;
  private static volatile boolean finished = false;
  private static VirtualMachine vm;

  public static void main(String[] args) throws Exception {
    Map<String, String> job = readJob();
    mainClass = job.getOrDefault("mainClass", "Main");
    String classPath = System.getProperty("prizm.tracer.classpath", "");
    String targetPath = job.getOrDefault("classes", "");
    String cp = targetPath + System.getProperty("path.separator") + classPath;
    LaunchingConnector connector = Bootstrap.virtualMachineManager().defaultConnector();
    Map<String, Connector.Argument> options = connector.defaultArguments();
    options.get("main").setValue(mainClass);
    options.get("options").setValue("-cp \"" + cp + "\"");
    options.get("suspend").setValue("true");
    vm = connector.launch(options);
    Process target = vm.process();
    ByteArrayOutputStream captured = new ByteArrayOutputStream();
    Thread pump = new Thread(() -> {
      try { target.getInputStream().transferTo(captured); } catch (Exception ignored) {}
    });
    pump.setDaemon(true); pump.start();
    vm.setDebugTraceMode(VirtualMachine.TRACE_NONE);
    MethodEntryRequest methods = vm.eventRequestManager().createMethodEntryRequest();
    methods.addClassFilter(mainClass); methods.setSuspendPolicy(MethodEntryRequest.SUSPEND_ALL); methods.enable();
    started = System.nanoTime();
    vm.resume();
    boolean sawMainEntry = false;
    while (!finished && (System.nanoTime() - started) < TimeUnit.SECONDS.toNanos(7)) {
      EventSet set;
      try { set = vm.eventQueue().remove(500); }
      catch (InterruptedException e) { continue; }
      if (set == null) continue;
      for (Event event : set) {
        if (event instanceof VMDeathEvent || event instanceof VMDisconnectEvent) { finished = true; continue; }
        if (event instanceof MethodEntryEvent entry) {
          // Only begin stepping at the student `main` — a static initializer
          // (<clinit>) entry must not disable the filter first.
          if (!sawMainEntry && "main".equals(entry.method().name())
              && entry.location().declaringType().name().equals(mainClass)) {
            sawMainEntry = true;
            methods.disable();
            StepRequest initial = vm.eventRequestManager().createStepRequest(entry.thread(), StepRequest.STEP_LINE, StepRequest.STEP_INTO);
            initial.addClassFilter(mainClass); initial.addCountFilter(1); initial.setSuspendPolicy(StepRequest.SUSPEND_ALL); initial.enable();
          }
          continue;
        }
        if (event instanceof com.sun.jdi.event.StepEvent) {
          record(((com.sun.jdi.event.StepEvent) event).thread());
          if (step >= 2000) { finished = true; break; }
          for (StepRequest old : vm.eventRequestManager().stepRequests()) {
            if (old.thread().equals(((com.sun.jdi.event.StepEvent) event).thread())) vm.eventRequestManager().deleteEventRequest(old);
          }
          StepRequest req = vm.eventRequestManager().createStepRequest(((com.sun.jdi.event.StepEvent) event).thread(), StepRequest.STEP_LINE, StepRequest.STEP_INTO);
          req.addClassFilter(mainClass); req.addCountFilter(1); req.setSuspendPolicy(StepRequest.SUSPEND_ALL); req.enable();
        }
      }
      set.resume();
    }
    if (!finished) { try { vm.exit(124); } catch (Exception ignored) {} }
    try { vm.process().getInputStream().transferTo(System.err); } catch (Exception ignored) {}
    String output = captured.toString(java.nio.charset.StandardCharsets.UTF_8);
    String resultStatus = step > 0 || sawMainEntry ? "ok" : "timeout";
    System.out.println("{\"status\":\"" + resultStatus + "\",\"events\":[" + OUT + "],\"output\":\"" + escape(output) + "\",\"error\":" + (resultStatus.equals("ok") ? "null" : "{\"type\":\"TimeoutError\",\"message\":\"Java debugger produced no step events.\"}") + "}");
  }

  /** Student-contiguous frame depth: index of the deepest matching frame + 1,
   * scanning from the top; 0 when the top frame is not student code. */
  private static int studentDepth(com.sun.jdi.ThreadReference thread) {
    int depth = 0;
    try {
      for (int i = 0; i < thread.frameCount(); i++) {
        if (thread.frame(i).location().declaringType().name().equals(mainClass)) depth = i + 1;
        else break;
      }
    } catch (Exception ignored) {}
    return depth;
  }

  private static void record(com.sun.jdi.ThreadReference thread) {
    try {
      int depth = studentDepth(thread);
      if (depth < 1) return;
      StackFrame frame = thread.frame(0);
      int line = frame.location().lineNumber();
      if (line < 0) return;
      String function = frame.location().method().name();
      Map<LocalVariable, Value> vars = new HashMap<>();
      try { vars = frame.getValues(frame.visibleVariables()); } catch (Exception ignored) {}
      StringBuilder locals = new StringBuilder("{");
      boolean first = true;
      for (Map.Entry<LocalVariable, Value> e : vars.entrySet()) {
        if (!first) locals.append(','); first = false;
        locals.append('"').append(escape(e.getKey().name())).append("\":").append(valueJson(e.getValue()));
      }
      locals.append('}');
      String frameId = FRAME_IDS.computeIfAbsent(depth, d -> "f" + d);
      String parentId = depth >= 2 ? FRAME_IDS.computeIfAbsent(depth - 1, d -> "f" + d) : null;

      if (prevStudentDepth < 0) {
        prevStudentDepth = depth;   // first stop establishes the base frame
      } else if (depth > prevStudentDepth) {
        appendEvent("call", line, function, frameId, parentId, locals);
      } else if (depth < prevStudentDepth) {
        String leftFn = METHOD_AT_DEPTH.getOrDefault(prevStudentDepth, function);
        String leftFrame = FRAME_IDS.computeIfAbsent(prevStudentDepth, d -> "f" + d);
        String leftParent = prevStudentDepth >= 2
            ? FRAME_IDS.computeIfAbsent(prevStudentDepth - 1, d -> "f" + d) : null;
        appendEvent("return", line, leftFn, leftFrame, leftParent, locals);
      }
      // Refresh the per-depth method table AFTER the return bookkeeping so
      // the "function we left" name survives one more record. Frame(i) sits
      // at student depth (depth - i): top frame = `depth`, bottom = 1.
      for (int i = 0; i < depth; i++) {
        METHOD_AT_DEPTH.put(depth - i, thread.frame(i).location().method().name());
      }
      prevStudentDepth = depth;
      appendEvent("line", line, function, frameId, parentId, locals);
    } catch (Exception ignored) {}
  }

  private static void appendEvent(String kind, int line, String function, String frameId,
                                  String parentId, StringBuilder locals) {
    if (OUT.length() > 0) OUT.append(',');
    OUT.append("{\"step\":").append(++step).append(",\"event\":\"").append(kind)
      .append("\",\"line\":").append(line)
      .append(",\"functionName\":\"").append(escape(function))
      .append("\",\"frameId\":\"").append(frameId)
      .append("\",\"parentFrameId\":").append(parentId == null ? "null" : "\"" + parentId + "\"")
      .append(",\"locals\":").append(locals)
      .append(",\"output\":\"\",\"value\":null,\"exception\":null}");
  }

  private static String valueJson(Value value) {
    if (value == null) return "{\"type\":\"null\",\"value\":null}";
    String type, val;
    if (value instanceof com.sun.jdi.BooleanValue) { type = "boolean"; val = value.toString(); }
    else if (value instanceof com.sun.jdi.PrimitiveValue) { type = "number"; val = value.toString(); }
    else if (value instanceof com.sun.jdi.StringReference) { type = "string"; val = "\"" + escape(((com.sun.jdi.StringReference)value).value()) + "\""; }
    else { type = "object"; val = null; }
    if (val == null) return "{\"type\":\"object\",\"id\":\"" + escape(value.type().name()) + "\",\"label\":\"" + escape(value.toString()) + "\"}";
    return "{\"type\":\"" + type + "\",\"value\":" + val + "}";
  }

  private static String escape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
  }

  private static Map<String, String> readJob() throws Exception {
    BufferedReader r = new BufferedReader(new InputStreamReader(System.in));
    String s = r.readLine(); Map<String, String> result = new HashMap<>();
    if (s == null) return result;
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\\"(\\w+)\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"])*)\\\"").matcher(s);
    while (m.find()) result.put(m.group(1), m.group(2).replace("\\\"", "\"").replace("\\\\", "\\"));
    return result;
  }
}
