#include <iostream>
using namespace std;

int main() {
    int total = 0;
    for (int i = 1; i <= 10; i++) {
        total += i;
    }
    cout << "sum 1..10 = " << total << endl;

    int n;
    cout << "Factorial of: ";
    cin >> n;
    long long f = 1;
    for (int i = 2; i <= n; i++) f *= i;
    cout << n << "! = " << f << endl;
    return 0;
}
