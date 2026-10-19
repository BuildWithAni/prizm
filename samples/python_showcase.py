def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)


def fib(n):
    a, b = 0, 1
    for i in range(n + 1):
        a, b = b, a + b
    return a


total = 0
for k in range(1, 6):
    value = fib(k)
    total += value
    if total > 10:
        print("big  :", k, value, total)
    else:
        print("small:", k, value, total)

print("factorial(5) =", factorial(5))
print("final total  =", total)
