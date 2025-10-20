import os
import unittest
from unittest.mock import patch

from app.main import Settings


class SettingsLoadSMTPAliasTests(unittest.TestCase):
    def test_supports_common_smtp_aliases(self) -> None:
        env = {
            "SMTP_SERVER": "smtp.example.com",
            "SMTP_PORT": "2525",
            "SMTP_USERNAME": "smtp-user",
            "SMTP_PASSWORD": "smtp-pass",
            "SMTP_FROM": "no-reply@example.com",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = Settings.load()

        self.assertEqual(settings.smtp_host, "smtp.example.com")
        self.assertEqual(settings.smtp_port, 2525)
        self.assertEqual(settings.smtp_user, "smtp-user")
        self.assertEqual(settings.smtp_password, "smtp-pass")
        self.assertEqual(settings.smtp_sender, "no-reply@example.com")

    def test_prefers_primary_variables_when_present(self) -> None:
        env = {
            "SMTP_HOST": "primary.example.com",
            "SMTP_SERVER": "smtp.example.com",
            "SMTP_USER": "primary-user",
            "SMTP_USERNAME": "smtp-user",
            "SMTP_PASS": "primary-pass",
            "SMTP_PASSWORD": "smtp-pass",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = Settings.load()

        self.assertEqual(settings.smtp_host, "primary.example.com")
        self.assertEqual(settings.smtp_user, "primary-user")
        self.assertEqual(settings.smtp_password, "primary-pass")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
