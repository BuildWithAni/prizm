// PRIZM Go tracer: instruments student source with per-line trace hooks,
// compiles the instrumented module, runs it, and emits the shared Prizm
// event schema as one JSON document on stdout.
//
// Injection model (same idea as Python Tutor's Go backend): every statement
// gets a __prizmE("line", <original line>, fn, locals) call before it, every
// function a "call" event, every return a "return" event (single-expression
// returns capture the value via the generic __prizmR wrapper). Reported line
// numbers always refer to the ORIGINAL source, so drift in the printed
// instrumented file cannot desync the visualizer.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type job struct {
	Source string `json:"source"`
	Stdin  string `json:"stdin"`
	Go     string `json:"go"`
}

const hookSource = `package main

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"sync"
	"time"
)

var (
	__pf        *os.File
	__pmu       sync.Mutex
	__pseq      int
	__pdepth    int
	__pframes   [128]string
	__pcap      = 2000
	__pdeadline time.Time
)

func __prizmInit() {
	path := os.Getenv("PRIZM_EVENTS")
	if path == "" {
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return
	}
	__pf = f
	__pdeadline = time.Now().Add(4 * time.Second)
}

func __prizmTrunc(s string) string {
	if len(s) > 160 {
		return s[:160]
	}
	return s
}

func __prizmSer(v any, depth int) any {
	if depth > 3 {
		return map[string]any{"type": "object", "id": "Nested", "label": __prizmTrunc(fmt.Sprintf("%v", v))}
	}
	switch t := v.(type) {
	case nil:
		return map[string]any{"type": "null", "value": nil}
	case bool:
		return map[string]any{"type": "boolean", "value": t}
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return map[string]any{"type": "number", "value": t}
	case string:
		return map[string]any{"type": "string", "value": __prizmTrunc(t)}
	default:
		rv := reflect.ValueOf(v)
		switch rv.Kind() {
		case reflect.Slice, reflect.Array:
			ser := make([]any, 0, 8)
			for i := 0; i < rv.Len() && i < 8; i++ {
				ser = append(ser, __prizmSer(rv.Index(i).Interface(), depth+1))
			}
			return map[string]any{"type": "array", "value": ser}
		default:
			return map[string]any{"type": "object", "id": fmt.Sprintf("%T", v), "label": __prizmTrunc(fmt.Sprintf("%v", v))}
		}
	}
}

func __prizmEmit(kind string, line int, fn string, locals map[string]any, value any) {
	if __pf == nil {
		return
	}
	__pmu.Lock()
	defer __pmu.Unlock()
	if __pseq >= __pcap || time.Now().After(__pdeadline) {
		return
	}
	if kind == "call" {
		__pdepth++
		if __pdepth < len(__pframes) {
			__pframes[__pdepth] = fmt.Sprintf("f%d", __pseq+1)
		}
	}
	frame := "f1"
	if __pdepth > 0 {
		if __pdepth < len(__pframes) {
			frame = __pframes[__pdepth]
		} else {
			frame = __pframes[len(__pframes)-1]
		}
	}
	__pseq++
	ser := make(map[string]any, len(locals))
	for name, v := range locals {
		ser[name] = __prizmSer(v, 0)
	}
	var parent any = nil
	if __pdepth > 1 {
		if __pdepth-1 < len(__pframes) {
			parent = __pframes[__pdepth-1]
		}
	}
	var serValue any = nil
	if kind == "return" && value != nil {
		serValue = __prizmSer(value, 0)
	}
	ev := map[string]any{
		"step":          __pseq,
		"event":         kind,
		"line":          line,
		"functionName":  fn,
		"frameId":       frame,
		"parentFrameId": parent,
		"locals":        ser,
		"output":        "",
		"value":         serValue,
		"exception":     nil,
	}
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	__pf.Write(append(b, '\n'))
	if kind == "return" && __pdepth > 0 {
		__pdepth--
	}
}

func __prizmE(kind string, line int, fn string, locals map[string]any) {
	__prizmEmit(kind, line, fn, locals, nil)
}

func __prizmR[T any](line int, fn string, locals map[string]any, v T) T {
	__prizmEmit("return", line, fn, locals, v)
	return v
}

func init() { __prizmInit() }
`

type result struct {
	Status string           `json:"status"`
	Events []map[string]any `json:"events"`
	Output string           `json:"output"`
	Error  map[string]any   `json:"error"`
}

func main() {
	raw, _ := io.ReadAll(os.Stdin)
	var j job
	_ = json.Unmarshal(raw, &j)
	if j.Go == "" {
		j.Go = "go"
	}

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "main.go", j.Source, parser.ParseComments)
	if err != nil {
		emit(result{Status: "syntax_error", Error: map[string]any{"type": "SyntaxError", "message": err.Error()}})
		return
	}
	instrument(file, fset)

	var printed bytes.Buffer
	if err := printer.Fprint(&printed, fset, file); err != nil {
		emit(result{Status: "crashed", Error: map[string]any{"type": "InstrumentError", "message": err.Error()}})
		return
	}

	tmp, err := os.MkdirTemp("", "prizm-go-run-")
	if err != nil {
		emit(result{Status: "crashed", Error: map[string]any{"type": "InternalError", "message": err.Error()}})
		return
	}
	defer os.RemoveAll(tmp)

	write := func(name, content string) {
		_ = os.WriteFile(filepath.Join(tmp, name), []byte(content), 0o644)
	}
	write("go.mod", "module student\n\ngo 1.21\n")
	write("main.go", printed.String())
	write("prizm_hook.go", hookSource)

	exe := filepath.Join(tmp, "student.exe")
	buildCtx, buildCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer buildCancel()
	build := exec.CommandContext(buildCtx, j.Go, "build", "-o", exe, ".")
	build.Dir = tmp
	build.Env = os.Environ()
	var buildOut bytes.Buffer
	build.Stdout, build.Stderr = &buildOut, &buildOut
	if err := build.Run(); err != nil {
		emit(result{Status: "crashed", Error: map[string]any{
			"type":    "InstrumentBuildError",
			"message": __trunc(buildOut.String()),
		}})
		return
	}

	eventsPath := filepath.Join(tmp, "events.ndjson")
	runCtx, runCancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer runCancel()
	run := exec.CommandContext(runCtx, exe)
	run.Dir = tmp
	run.Stdin = strings.NewReader(j.Stdin)
	var stdout, stderr bytes.Buffer
	run.Stdout, run.Stderr = &stdout, &stderr
	run.Env = append(os.Environ(), "PRIZM_EVENTS="+eventsPath)
	runErr := run.Run()
	timedOut := errors.Is(runCtx.Err(), context.DeadlineExceeded)

	rawEvents, _ := os.ReadFile(eventsPath)
	events := make([]map[string]any, 0, 64)
	for _, line := range strings.Split(string(rawEvents), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var ev map[string]any
		if json.Unmarshal([]byte(line), &ev) == nil {
			events = append(events, ev)
		}
	}

	status := "ok"
	var progErr map[string]any
	switch {
	case timedOut:
		status = "timeout"
		progErr = map[string]any{"type": "TimeoutError", "message": "Go trace exceeded its time budget and was stopped."}
	case runErr != nil:
		status = "error"
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = fmt.Sprintf("program exited with an error: %v", runErr)
		}
		typ := "RuntimeError"
		if strings.Contains(msg, "panic:") {
			typ = "Panic"
		}
		progErr = map[string]any{"type": typ, "message": __trunc(msg)}
	case len(events) >= 2000:
		status = "event_limit"
		progErr = map[string]any{"type": "EventLimit", "message": "Stopped after 2000 events."}
	}

	emit(result{Status: status, Events: events, Output: stdout.String(), Error: progErr})
}

func __trunc(s string) string {
	if len(s) > 3000 {
		return s[len(s)-3000:]
	}
	return s
}

func emit(r result) {
	if r.Events == nil {
		r.Events = []map[string]any{}
	}
	b, _ := json.Marshal(r)
	_, _ = os.Stdout.Write(b)
}

// --- instrumentation ---------------------------------------------------------

var currentFset *token.FileSet

func instrument(file *ast.File, fset *token.FileSet) {
	currentFset = fset
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		scope := map[string]bool{}
		if fn.Recv != nil {
			collectFieldNames(fn.Recv, scope)
		}
		if fn.Type.Params != nil {
			collectFieldNames(fn.Type.Params, scope)
		}
		if fn.Type.Results != nil {
			collectFieldNames(fn.Type.Results, scope)
		}
		name := fn.Name.Name
		entry := callExpr(name, "call", lineOf(fn), scope)
		body := walkBlock(fn.Body, scope, name)
		if entry != nil {
			body.List = append([]ast.Stmt{entry}, body.List...)
		}
		fn.Body = body
	}
}

func collectFieldNames(list *ast.FieldList, scope map[string]bool) {
	for _, f := range list.List {
		for _, n := range f.Names {
			if n.Name != "_" {
				scope[n.Name] = true
			}
		}
	}
}

func copyScope(src map[string]bool) map[string]bool {
	dst := make(map[string]bool, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func lineOf(node ast.Node) int {
	return currentFset.Position(node.Pos()).Line
}

func injectable(stmt ast.Stmt) bool {
	switch stmt.(type) {
	case *ast.AssignStmt, *ast.ExprStmt, *ast.IncDecStmt, *ast.ReturnStmt,
		*ast.IfStmt, *ast.ForStmt, *ast.RangeStmt, *ast.SwitchStmt,
		*ast.TypeSwitchStmt, *ast.SelectStmt, *ast.GoStmt, *ast.DeferStmt,
		*ast.DeclStmt, *ast.SendStmt, *ast.BlockStmt, *ast.LabeledStmt:
		return true
	}
	return false
}

func localsExpr(scope map[string]bool) ast.Expr {
	names := make([]string, 0, len(scope))
	for name := range scope {
		if name != "_" && name != "" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		expr, _ := parser.ParseExpr("nil")
		return expr
	}
	var sb strings.Builder
	sb.WriteString("map[string]any{")
	for i, name := range names {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString(strconv.Quote(name))
		sb.WriteString(": ")
		sb.WriteString(name)
	}
	sb.WriteString("}")
	expr, err := parser.ParseExpr(sb.String())
	if err != nil {
		n, _ := parser.ParseExpr("nil")
		return n
	}
	return expr
}

func callExpr(fnName, kind string, line int, scope map[string]bool) *ast.ExprStmt {
	expr, err := parser.ParseExpr(fmt.Sprintf("__prizmE(%q, %d, %q, nil)", kind, line, fnName))
	if err != nil {
		return nil
	}
	call, ok := expr.(*ast.CallExpr)
	if !ok {
		return nil
	}
	call.Args[3] = localsExpr(scope)
	return &ast.ExprStmt{X: call}
}

func isCallExpr(e ast.Expr) bool {
	_, ok := e.(*ast.CallExpr)
	return ok
}

func wrapReturn(line int, fnName string, scope map[string]bool, result ast.Expr) ast.Expr {
	expr, err := parser.ParseExpr(fmt.Sprintf("__prizmR(%d, %q, nil, nil)", line, fnName))
	if err != nil {
		return result
	}
	call, ok := expr.(*ast.CallExpr)
	if !ok {
		return result
	}
	call.Args[2] = localsExpr(scope)
	call.Args[3] = result
	return call
}

// walkBlock returns a copy of `block` with per-statement injections.
func walkBlock(block *ast.BlockStmt, scope map[string]bool, fnName string) *ast.BlockStmt {
	child := copyScope(scope)
	out := &ast.BlockStmt{Lbrace: block.Lbrace, Rbrace: block.Rbrace}
	for _, stmt := range block.List {
		if injectable(stmt) {
			if ev := callExpr(fnName, "line", lineOf(stmt), child); ev != nil {
				out.List = append(out.List, ev)
			}
		}
		out.List = append(out.List, transformStmt(stmt, child, fnName)...)
		applyDeclarations(stmt, child)
	}
	return out
}

// transformStmt rewrites one statement (recursing into block bodies).
func transformStmt(stmt ast.Stmt, scope map[string]bool, fnName string) []ast.Stmt {
	switch s := stmt.(type) {
	case *ast.ReturnStmt:
		replacements := []ast.Stmt{}
		if len(s.Results) == 1 && !isCallExpr(s.Results[0]) {
			s.Results[0] = wrapReturn(lineOf(s), fnName, scope, s.Results[0])
			replacements = append(replacements, s)
		} else {
			if ev := callExpr(fnName, "return", lineOf(s), scope); ev != nil {
				replacements = append(replacements, ev)
			}
			replacements = append(replacements, s)
		}
		return replacements
	case *ast.IfStmt:
		if s.Body != nil {
			bodyScope := copyScope(scope)
			if s.Init != nil {
				applyDeclarations(s.Init, bodyScope)
			}
			s.Body = walkBlock(s.Body, bodyScope, fnName)
		}
		if elseBlock, ok := s.Else.(*ast.BlockStmt); ok {
			s.Else = walkBlock(elseBlock, copyScope(scope), fnName)
		} else if elseIf, ok := s.Else.(*ast.IfStmt); ok {
			s.Else = transformStmt(elseIf, scope, fnName)[0]
		}
		instrumentExprs([]ast.Expr{s.Cond}, scope, fnName)
		return []ast.Stmt{s}
	case *ast.ForStmt:
		bodyScope := copyScope(scope)
		if s.Init != nil {
			applyDeclarations(s.Init, bodyScope)
		}
		if s.Body != nil {
			s.Body = walkBlock(s.Body, bodyScope, fnName)
		}
		instrumentExprs([]ast.Expr{s.Cond}, scope, fnName)
		return []ast.Stmt{s}
	case *ast.RangeStmt:
		bodyScope := copyScope(scope)
		if s.Tok == token.DEFINE {
			collectNames(s.Key, bodyScope)
			collectNames(s.Value, bodyScope)
		}
		if s.Body != nil {
			s.Body = walkBlock(s.Body, bodyScope, fnName)
		}
		instrumentExprs([]ast.Expr{s.X}, scope, fnName)
		return []ast.Stmt{s}
	case *ast.SwitchStmt:
		bodyScope := copyScope(scope)
		if s.Init != nil {
			applyDeclarations(s.Init, bodyScope)
		}
		s.Body = walkCaseBlock(s.Body, bodyScope, fnName)
		if s.Tag != nil {
			instrumentExprs([]ast.Expr{s.Tag}, scope, fnName)
		}
		return []ast.Stmt{s}
	case *ast.TypeSwitchStmt:
		bodyScope := copyScope(scope)
		if assign, ok := s.Assign.(*ast.AssignStmt); ok && assign.Tok == token.DEFINE && len(assign.Lhs) > 0 {
			collectNames(assign.Lhs[0], bodyScope)
		}
		s.Body = walkCaseBlock(s.Body, bodyScope, fnName)
		return []ast.Stmt{s}
	case *ast.SelectStmt:
		for _, stmt := range s.Body.List {
			comm, ok := stmt.(*ast.CommClause)
			if !ok {
				continue
			}
			commScope := copyScope(scope)
			rewritten := make([]ast.Stmt, 0, len(comm.Body)+1)
			if ev := callExpr(fnName, "line", lineOf(comm), commScope); ev != nil {
				rewritten = append(rewritten, ev)
			}
			for _, cs := range comm.Body {
				if injectable(cs) {
					if ev := callExpr(fnName, "line", lineOf(cs), commScope); ev != nil {
						rewritten = append(rewritten, ev)
					}
				}
				rewritten = append(rewritten, transformStmt(cs, commScope, fnName)...)
				applyDeclarations(cs, commScope)
			}
			comm.Body = rewritten
		}
		return []ast.Stmt{s}
	case *ast.LabeledStmt:
		inner := transformStmt(s.Stmt, scope, fnName)
		s.Stmt = inner[len(inner)-1]
		return append([]ast.Stmt{s}, inner[:len(inner)-1]...)
	case *ast.BlockStmt:
		return []ast.Stmt{walkBlock(s, copyScope(scope), fnName)}
	default:
		instrumentExprs(exprsOf(stmt), scope, fnName)
		return []ast.Stmt{stmt}
	}
}

// walkCaseBlock rewrites a switch case body with per-clause scopes.
func walkCaseBlock(body *ast.BlockStmt, scope map[string]bool, fnName string) *ast.BlockStmt {
	if body == nil {
		return nil
	}
	out := &ast.BlockStmt{Lbrace: body.Lbrace, Rbrace: body.Rbrace}
	for _, stmt := range body.List {
		clause, ok := stmt.(*ast.CaseClause)
		if !ok {
			out.List = append(out.List, stmt)
			continue
		}
		instrumentExprs(clause.List, scope, fnName)
		clauseScope := copyScope(scope)
		rewritten := make([]ast.Stmt, 0, len(clause.Body)+1)
		if ev := callExpr(fnName, "line", lineOf(clause), clauseScope); ev != nil {
			rewritten = append(rewritten, ev)
		}
		for _, cs := range clause.Body {
			if injectable(cs) {
				if ev := callExpr(fnName, "line", lineOf(cs), clauseScope); ev != nil {
					rewritten = append(rewritten, ev)
				}
			}
			rewritten = append(rewritten, transformStmt(cs, clauseScope, fnName)...)
			applyDeclarations(cs, clauseScope)
		}
		clause.Body = rewritten
		out.List = append(out.List, clause)
	}
	return out
}

// exprsOf lists the expression positions of a simple statement.
func exprsOf(stmt ast.Stmt) []ast.Expr {
	switch s := stmt.(type) {
	case *ast.AssignStmt:
		out := make([]ast.Expr, 0, len(s.Rhs))
		out = append(out, s.Rhs...)
		return out
	case *ast.ExprStmt:
		return []ast.Expr{s.X}
	case *ast.IncDecStmt:
		return []ast.Expr{s.X}
	case *ast.SendStmt:
		return []ast.Expr{s.Value, s.Chan}
	case *ast.GoStmt:
		return []ast.Expr{s.Call}
	case *ast.DeferStmt:
		return []ast.Expr{s.Call}
	case *ast.ReturnStmt:
		return s.Results
	}
	return nil
}

// instrumentExprs instruments function literals living inside expressions.
func instrumentExprs(exprs []ast.Expr, scope map[string]bool, fnName string) {
	for _, e := range exprs {
		if e == nil {
			continue
		}
		ast.Inspect(e, func(n ast.Node) bool {
			lit, ok := n.(*ast.FuncLit)
			if !ok || lit.Body == nil {
				return true
			}
			litScope := copyScope(scope)
			if lit.Type.Params != nil {
				collectFieldNames(lit.Type.Params, litScope)
			}
			entry := callExpr("<func>", "call", lineOf(lit), litScope)
			body := walkBlock(lit.Body, litScope, "<func>")
			if entry != nil {
				body.List = append([]ast.Stmt{entry}, body.List...)
			}
			lit.Body = body
			return false
		})
	}
}

// collectNames adds declared identifiers of an expression (nil-safe).
func collectNames(expr ast.Expr, scope map[string]bool) {
	ident, ok := expr.(*ast.Ident)
	if ok && ident.Name != "_" {
		scope[ident.Name] = true
	}
}

// applyDeclarations folds a statement's declarations into the scope so the
// NEXT statements can reference the new names. Range vars are deliberately
// excluded — they live only inside the loop body (handled in transformStmt).
func applyDeclarations(stmt ast.Stmt, scope map[string]bool) {
	switch s := stmt.(type) {
	case *ast.AssignStmt:
		if s.Tok == token.DEFINE {
			for _, lhs := range s.Lhs {
				collectNames(lhs, scope)
			}
		}
	case *ast.DeclStmt:
		if gen, ok := s.Decl.(*ast.GenDecl); ok {
			for _, spec := range gen.Specs {
				if vs, ok := spec.(*ast.ValueSpec); ok {
					for _, name := range vs.Names {
						if name.Name != "_" {
							scope[name.Name] = true
						}
					}
				}
			}
		}
	}
}
