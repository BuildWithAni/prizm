def half(x):
    return x / 0  # ZeroDivisionError on purpose


print("about to crash...")
print(half(8))
