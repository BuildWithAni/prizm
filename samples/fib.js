function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const series = [];
for (let i = 0; i <= 8; i++) {
  series.push(fibonacci(i));
}

console.log("fib:", series.join(", "));
console.log("sum:", series.reduce((a, b) => a + b, 0));
