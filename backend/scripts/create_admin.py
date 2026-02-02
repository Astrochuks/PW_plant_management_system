#!/usr/bin/env python3
"""Bootstrap script to create the first admin user.

Run this once to create the initial admin account:
    python scripts/create_admin.py

You can also use environment variables:
    ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=securepassword123 python scripts/create_admin.py
"""

import os
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from getpass import getpass


def create_admin_user():
    """Create the first admin user."""
    # Import after path setup
    from app.core.database import get_supabase_admin_client
    from app.config import get_settings

    settings = get_settings()
    client = get_supabase_admin_client()

    print("\n" + "=" * 50)
    print("Plant Management System - Admin Setup")
    print("=" * 50 + "\n")

    # Check if admin already exists
    existing = (
        client.table("users")
        .select("id, email")
        .eq("role", "admin")
        .execute()
    )

    if existing.data:
        print(f"⚠️  Admin user already exists: {existing.data[0]['email']}")
        response = input("\nCreate another admin? (y/N): ").strip().lower()
        if response != "y":
            print("Exiting.")
            return

    # Get admin details from environment or prompt
    email = os.environ.get("ADMIN_EMAIL")
    password = os.environ.get("ADMIN_PASSWORD")
    full_name = os.environ.get("ADMIN_NAME")

    if not email:
        email = input("Admin email: ").strip()
        if not email or "@" not in email:
            print("❌ Invalid email address")
            return

    if not password:
        password = getpass("Admin password (min 12 chars): ")
        if len(password) < 12:
            print("❌ Password must be at least 12 characters")
            return

        confirm = getpass("Confirm password: ")
        if password != confirm:
            print("❌ Passwords do not match")
            return

    if not full_name:
        full_name = input("Full name: ").strip() or "System Admin"

    print(f"\nCreating admin user: {email}")

    try:
        # Create user in Supabase Auth
        auth_response = client.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
        })

        if not auth_response.user:
            print("❌ Failed to create user in Supabase Auth")
            return

        user_id = auth_response.user.id
        print(f"✅ Auth user created: {user_id}")

        # Create user record in our users table
        user_data = {
            "id": user_id,
            "email": email,
            "full_name": full_name,
            "role": "admin",
            "is_active": True,
            "must_change_password": False,  # Admin doesn't need to change
        }

        client.table("users").insert(user_data).execute()
        print(f"✅ User record created in database")

        print("\n" + "=" * 50)
        print("✅ Admin user created successfully!")
        print("=" * 50)
        print(f"\n  Email: {email}")
        print(f"  Role:  admin")
        print(f"\n  You can now log in at: http://localhost:8000/docs")
        print("=" * 50 + "\n")

    except Exception as e:
        print(f"\n❌ Error creating admin user: {e}")

        # Try to clean up if auth user was created
        if "user_id" in dir():
            try:
                client.auth.admin.delete_user(user_id)
                print("  (Cleaned up partial auth user)")
            except:
                pass


if __name__ == "__main__":
    create_admin_user()
