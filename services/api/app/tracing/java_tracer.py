"""Launches the JDI-based JavaTraceDriver and returns its trace JSON."""
from __future__ import annotations

import json
import os
import subprocess
import sys


def main() -> int:
    job = json.loads(sys.stdin.read() or "{}")
    java = job.get("java", "java")
    tracer_cp = os.environ.get("PRIZM_JAVA_TRACER_CLASSPATH", "")
    # JDI modules are included with standard JDK installations.
    process = subprocess.run([java, "--add-modules", "jdk.jdi", "-Dprizm.tracer.classpath=" + tracer_cp,
                              "-cp", tracer_cp, "JavaTraceDriver"], input=json.dumps(job), capture_output=True,
                             text=True, encoding="utf-8", errors="replace", timeout=9)
    if process.returncode:
        print(json.dumps({"status": "crashed", "events": [], "output": "", "error": {
            "type": "JavaTracerError", "message": (process.stderr or process.stdout)[-2000:]}}))
        return 0
    lines = [line for line in process.stdout.splitlines() if line.startswith("{")]
    print(lines[-1] if lines else json.dumps({"status": "crashed", "events": [], "output": "", "error": {
        "type": "JavaTracerError", "message": "Java trace driver returned no result."}}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
