import base64
import datetime as dt
import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest
import zipfile


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parent.parent / 'scripts' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prepare = load('prepare-ios-beta')
verify = load('verify-ios-beta')


class IOSBetaTests(unittest.TestCase):
    def setUp(self):
        self.env = {
            'APPLE_TEAM_ID': 'ABC1234567',
            'APPSTORE_API_KEY_ID': 'KEY1234567',
            'APPSTORE_ISSUER_ID': '11111111-2222-3333-4444-555555555555',
            'APPSTORE_API_PRIVATE_KEY': '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----',
            'IOS_DISTRIBUTION_CERTIFICATE_PASSWORD': 'private-password',
            'IOS_DISTRIBUTION_CERTIFICATE_BASE64': base64.b64encode(b'c' * 2000).decode(),
            'IOS_PROVISIONING_PROFILE_BASE64': base64.b64encode(b'p' * 2000).decode(),
            'GOOGLE_SERVER_CLIENT_ID': '123-web.apps.googleusercontent.com',
            'GOOGLE_IOS_CLIENT_ID': '123-ios.apps.googleusercontent.com',
            'GITHUB_RUN_NUMBER': '12',
            'GITHUB_RUN_ATTEMPT': '1',
        }
        self.profile = {
            'TeamIdentifier': ['ABC1234567'],
            'ApplicationIdentifierPrefix': ['ABC1234567'],
            'Entitlements': {
                'com.apple.developer.team-identifier': 'ABC1234567',
                'application-identifier': 'ABC1234567.app.rephase.Rephase',
                'get-task-allow': False,
            },
            'UUID': '11111111-2222-3333-4444-555555555555',
            'DeveloperCertificates': [b'certificate'],
            'ExpirationDate': dt.datetime(2030, 1, 1),
        }

    def test_configuration_requires_credentials_and_separates_public_config(self):
        for name in self.env:
            with self.subTest(name=name), self.assertRaises(ValueError):
                prepare.configuration({**self.env, name: ''})
        _, _, public, build = prepare.configuration(self.env)
        self.assertEqual(build, '12.1')
        self.assertEqual(set(public), {'API_ORIGIN', 'GOOGLE_SERVER_CLIENT_ID', 'GOOGLE_IOS_CLIENT_ID'})
        self.assertEqual(public['API_ORIGIN'], 'https://rephase.surtani.org')
        self.assertEqual(prepare.configuration({**self.env, 'GITHUB_RUN_ATTEMPT': '2'})[3], '12.2')
        with self.assertRaises(ValueError):
            prepare.configuration({**self.env, 'GITHUB_RUN_NUMBER': '10000'})
        for origin in ('http://example.com', 'https://example.com/', 'https://user:secret@example.com', 'https://example.com?token=x'):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                prepare.configuration({**self.env, 'API_ORIGIN': origin})
        self.assertEqual(prepare.configuration({**self.env, 'API_ORIGIN': 'https://api.example.com'})[2]['API_ORIGIN'], 'https://api.example.com')

    def test_profile_rejects_wrong_identity_expiry_and_non_store_distribution(self):
        now = dt.datetime(2026, 11, 15, tzinfo=dt.timezone.utc)
        self.assertEqual(prepare.validate_profile(self.profile, 'ABC1234567', now), self.profile['UUID'])
        invalid = [
            {**self.profile, 'TeamIdentifier': ['OTHER12345']},
            {**self.profile, 'ExpirationDate': dt.datetime(2020, 1, 1)},
            {**self.profile, 'ProvisionedDevices': ['device']},
            {**self.profile, 'ProvisionsAllDevices': True},
            {**self.profile, 'DeveloperCertificates': []},
        ]
        for values in ({'get-task-allow': True}, {'application-identifier': 'ABC1234567.*'},
                       {'application-identifier': 'ABC1234567.app.rephase.Other'}):
            invalid.append({**self.profile, 'Entitlements': {**self.profile['Entitlements'], **values}})
        for profile in invalid:
            with self.assertRaises(ValueError):
                prepare.validate_profile(profile, 'ABC1234567', now)

    def test_private_files_do_not_overwrite_developer_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            prepare.private_write(path, b'original')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                prepare.private_write(path, b'replacement')
            self.assertEqual(path.read_bytes(), b'original')

    def test_exported_ipa_must_have_expected_identity_build_and_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'app.ipa'
            for bundle, build, profile, valid in [
                ('app.rephase.Rephase', '12.1', True, True),
                ('app.rephase.Other', '12.1', True, False),
                ('app.rephase.Rephase', '11.1', True, False),
                ('app.rephase.Rephase', '12.1', False, False),
            ]:
                with zipfile.ZipFile(path, 'w') as archive:
                    archive.writestr('Payload/Runner.app/Info.plist', plistlib.dumps({
                        'CFBundleIdentifier': bundle, 'CFBundleVersion': build,
                    }))
                    if profile:
                        archive.writestr('Payload/Runner.app/embedded.mobileprovision', b'profile')
                if valid:
                    self.assertEqual(len(verify.verify_ipa(path, '12.1')), 64)
                else:
                    with self.assertRaises(ValueError):
                        verify.verify_ipa(path, '12.1')


if __name__ == '__main__':
    unittest.main()
