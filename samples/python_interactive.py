name = input("Who is playing? ")
score = 0
round_no = 1

while True:
    answer = int(input(f"Q{round_no}: what is {round_no} * 7? "))
    if answer == round_no * 7:
        score += 1
        print("  Correct!")
    else:
        print(f"  Nope — it was {round_no * 7}.")
    if input("Another? (y/n) ") != "y":
        break
    round_no += 1

print(f"Bye {name} — you scored {score}/{round_no}!")
