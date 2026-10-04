"""Print an argon2id hash for one FALLBACK_ACCOUNTS entry. The password is read without echo and
never printed.

    uv run python scripts/hash_password.py
"""

import getpass
import sys

from argon2 import PasswordHasher


def main() -> int:
    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Again: "):
        print("The passwords differ.", file=sys.stderr)
        return 1
    if len(password) < 12:
        print("Use at least 12 characters.", file=sys.stderr)
        return 1
    print(PasswordHasher().hash(password))
    return 0


if __name__ == "__main__":
    sys.exit(main())
