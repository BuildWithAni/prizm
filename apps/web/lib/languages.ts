/**
 * Language catalog + starter programs shared by the editor and the visualizer.
 */

export interface LanguageOption {
  id: string;
  name: string;
  icon: string;
  extension: string;
}

export const LANGUAGE_CATALOG: LanguageOption[] = [
  { id: "python", name: "Python", icon: "python.svg", extension: ".py" },
  { id: "javascript", name: "JavaScript", icon: "javascript.svg", extension: ".js" },
  { id: "typescript", name: "TypeScript", icon: "typescript.svg", extension: ".ts" },
  { id: "c", name: "C", icon: "c.svg", extension: ".c" },
  { id: "cpp", name: "C++", icon: "cpp.svg", extension: ".cpp" },
  { id: "java", name: "Java", icon: "java.svg", extension: ".java" },
  { id: "kotlin", name: "Kotlin", icon: "kotlin.svg", extension: ".kt" },
  { id: "go", name: "Go", icon: "go.svg", extension: ".go" },
  { id: "rust", name: "Rust", icon: "rust.svg", extension: ".rs" },
  { id: "php", name: "PHP", icon: "php.svg", extension: ".php" },
  { id: "ruby", name: "Ruby", icon: "ruby.svg", extension: ".rb" },
  { id: "csharp", name: "C#", icon: "csharp.svg", extension: ".cs" },
  { id: "html", name: "HTML/CSS/JS", icon: "html5.svg", extension: ".html" },
];

/** Languages the tracer supports when the /api/languages list is unavailable. */
export const KNOWN_TRACE_LANGUAGES = [
  "python",
  "javascript",
  "typescript",
  "java",
  "kotlin",
  "c",
  "cpp",
  "go",
  "ruby",
];

/** Languages rendered live in a sandboxed browser preview (no server run). */
export const PREVIEW_LANGUAGES = ["html"];

/** Starter programs per language — swapped on language change (unless edited). */
export const TEMPLATES: Record<string, string> = {
  python: `def square(n):
    result = n * n
    return result

x = 4
y = square(x)
print(y)
`,
  javascript: `function square(n) {
  return n * n;
}

const x = 4;
const y = square(x);
console.log(y);
`,
  cpp: `#include <iostream>
using namespace std;

int main() {
  int x = 4;
  int y = x * x;
  cout << y << endl;
  return 0;
}
`,
  java: `public class Main {
  public static void main(String[] args) {
    int x = 4;
    int y = x * x;
    System.out.println(y);
  }
}
`,
  kotlin: `fun square(n: Int): Int {
    val r = n * n
    return r
}

fun main() {
    val x = 4
    val y = square(x)
    println(y)
}
`,
  c: `#include <stdio.h>

int main() {
    int x = 4;
    int y = x * x;
    printf("%d\\n", y);
    return 0;
}
`,
  typescript: `function square(n: number): number {
  return n * n;
}

const x = 4;
console.log(square(x));
`,
  go: `package main

import "fmt"

func main() {
    x := 4
    fmt.Println(x * x)
}
`,
  rust: `fn main() {
    let x = 4;
    println!("{}", x * x);
}
`,
  csharp: `using System;

class Program {
    static void Main() {
        int x = 4;
        Console.WriteLine(x * x);
    }
}
`,
  php: `<?php
$x = 4;
echo $x * $x . PHP_EOL;
`,
  ruby: `x = 4
puts x * x
`,
  html: `<!doctype html>
<html>
  <body>
    <h1>Hello, PRIZM</h1>
    <script>console.log("Ready to code");</script>
  </body>
</html>
`,
};

/** Starter source for a language id (empty string when unknown). */
export function templateFor(language: string): string {
  return TEMPLATES[language] ?? "";
}
