"""Helper script to get authentication token for testing.

This script helps you login and get an admin token for testing the API.
"""

import asyncio
import httpx


API_BASE_URL = "http://localhost:8000/api/v1"


async def login():
    """Login and get auth token."""
    print("="*60)
    print("GET ADMIN AUTH TOKEN")
    print("="*60)

    email = input("\nEnter admin email: ").strip()
    password = input("Enter password: ").strip()

    if not email or not password:
        print("❌ Email and password required")
        return None

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            print("\n⏳ Logging in...")
            response = await client.post(
                f"{API_BASE_URL}/auth/login",
                json={"email": email, "password": password}
            )

            response.raise_for_status()
            data = response.json()

            if data.get("success") and data.get("access_token"):
                token = data["access_token"]
                user = data.get("user", {})

                print("\n✅ Login successful!")
                print(f"User: {user.get('full_name')} ({user.get('email')})")
                print(f"Role: {user.get('role')}")
                print(f"\nAuth Token: {token[:50]}...")

                # Save to file for easy copy-paste
                with open("auth_token.txt", "w") as f:
                    f.write(token)

                print("\n💾 Token saved to: auth_token.txt")
                print("\nYou can now run: python test_preview_upload.py")

                return token
            else:
                print(f"❌ Login failed: {data.get('message', 'Unknown error')}")
                return None

        except httpx.HTTPStatusError as e:
            print(f"\n❌ Login failed: {e}")
            print(f"Status: {e.response.status_code}")
            print(f"Response: {e.response.text}")
            return None

        except Exception as e:
            print(f"\n❌ Unexpected error: {e}")
            return None


async def main():
    """Run the login."""
    token = await login()

    if token:
        print("\n" + "="*60)
        print("NEXT STEPS:")
        print("="*60)
        print("1. Run: python test_preview_upload.py")
        print("2. When prompted for token, paste the token from auth_token.txt")
        print("3. Or the script will auto-read it if available")


if __name__ == "__main__":
    asyncio.run(main())
