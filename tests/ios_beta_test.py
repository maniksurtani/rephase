import base64
import datetime as dt
import hashlib
import importlib.util
from pathlib import Path
import plistlib
import tempfile
from unittest.mock import patch
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
            'IOS_MODE': 'upload',
            'IOS_VERSION': '0.1.0',
            'APP_STORE_CONNECT_KEY_ID': 'KEY1234567',
            'APP_STORE_CONNECT_ISSUER_ID': '11111111-2222-3333-4444-555555555555',
            'APP_STORE_CONNECT_PRIVATE_KEY': '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----',
            'IOS_DISTRIBUTION_P12_PASSWORD': 'private-password',
            'IOS_DISTRIBUTION_P12_BASE64': base64.b64encode(b'c' * 2000).decode(),
            'IOS_PROVISIONING_PROFILE_BASE64': base64.b64encode(b'p' * 2000).decode(),
            'GOOGLE_SERVER_CLIENT_ID': '123-web.apps.googleusercontent.com',
            'GOOGLE_IOS_CLIENT_ID': '123-ios.apps.googleusercontent.com',
            'GITHUB_RUN_NUMBER': '12',
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
        _, public, version, build = prepare.configuration(self.env)
        self.assertEqual(version, "0.1.0")
        self.assertEqual(build, '12')
        self.assertEqual(set(public), {'API_ORIGIN', 'GOOGLE_SERVER_CLIENT_ID', 'GOOGLE_IOS_CLIENT_ID'})
        self.assertEqual(public['API_ORIGIN'], 'https://rephase.surtani.org')
        self.assertEqual(prepare.configuration({**self.env, 'GITHUB_RUN_ATTEMPT': '2'})[3], '12')
        self.assertEqual(prepare.configuration({**self.env, 'GITHUB_RUN_NUMBER': '13'})[3], '13')
        for run in ('1', '9999'):
            self.assertEqual(prepare.configuration({**self.env, 'GITHUB_RUN_NUMBER': run})[3], run)
        for run in ('0', '-1', '01', '12.1', '12\n', '1e2', '10000'):
            with self.subTest(run=run), self.assertRaises(ValueError):
                prepare.configuration({**self.env, 'GITHUB_RUN_NUMBER': run})
        for origin in ('http://example.com', 'https://example.com/', 'https://user:secret@example.com', 'https://example.com?token=x'):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                prepare.configuration({**self.env, 'API_ORIGIN': origin})
        self.assertEqual(prepare.configuration({**self.env, 'API_ORIGIN': 'https://api.example.com'})[1]['API_ORIGIN'], 'https://api.example.com')

    def test_profile_rejects_wrong_identity_expiry_and_non_store_distribution(self):
        now = dt.datetime(2026, 11, 15, tzinfo=dt.timezone.utc)
        self.assertEqual(prepare.validate_profile(self.profile, now), ('ABC1234567', self.profile['UUID']))
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
                prepare.validate_profile(profile, now)

    def test_modes_require_only_the_credentials_they_use(self):
        env = {key: value for key, value in self.env.items()
               if not key.startswith('APP_STORE_CONNECT')}
        env['IOS_MODE'] = 'build'
        self.assertTrue(prepare.configuration(env)[0])
        env = {key: value for key, value in env.items()
               if not key.startswith(('IOS_DISTRIBUTION', 'IOS_PROVISIONING', 'GOOGLE_'))}
        env['IOS_MODE'] = 'validate'
        signing, public, _, _ = prepare.configuration(env)
        self.assertEqual(signing, {})
        self.assertEqual(public, {'API_ORIGIN': 'https://rephase.surtani.org'})
        for changes in ({'IOS_MODE': 'publish'}, {'IOS_VERSION': '0.1.0; echo bad'},
                        {'IOS_VERSION': '1.0'}, {'GITHUB_RUN_NUMBER': '10000'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                prepare.configuration({**env, **changes})

    def test_export_uses_exact_matching_valid_certificate_not_display_name(self):
        fingerprint = hashlib.sha1(b'certificate').hexdigest().upper()
        identity = f'  1) {fingerprint} "Any certificate label"\n 1 valid identities found'
        options = prepare.export_options(self.profile, identity)
        self.assertEqual(options['signingCertificate'], fingerprint)
        self.assertEqual(options['teamID'], 'ABC1234567')
        self.assertEqual(options['provisioningProfiles'], {'app.rephase.Rephase': self.profile['UUID']})
        for identities in ('0 valid identities found', f' 1) {"0" * 40} "Apple Distribution"'):
            with self.assertRaises(ValueError):
                prepare.export_options(self.profile, identities)
        other = b'other certificate'
        multiple = {**self.profile, 'DeveloperCertificates': [b'certificate', other]}
        identity += f'\n 2) {hashlib.sha1(other).hexdigest().upper()} "Another identity"'
        with self.assertRaises(ValueError):
            prepare.export_options(multiple, identity)

    def test_archive_requires_requested_version_and_compiled_icons(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory)
            app = archive / 'Products/Applications/Runner.app'
            app.mkdir(parents=True)
            info = {'CFBundleIdentifier': 'app.rephase.Rephase', 'CFBundleVersion': '12',
                    'CFBundleShortVersionString': '0.1.0',
                    'CFBundleIcons': {'CFBundlePrimaryIcon': {'CFBundleIconName': 'AppIcon'}}}
            (app / 'Info.plist').write_bytes(plistlib.dumps(info))
            (app / 'Assets.car').write_bytes(b'icons')
            verify.verify_archive(archive, '12', '0.1.0')
            with self.assertRaises(ValueError):
                verify.verify_archive(archive, '12', '0.2.0')
            (app / 'Assets.car').unlink()
            with self.assertRaises(ValueError):
                verify.verify_archive(archive, '12', '0.1.0')

    def test_cleanup_restores_keychains_and_removes_credentials_after_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / 'rephase-ios-beta'
            private.mkdir()
            (private / 'keychain-search-list.json').write_text('["login.keychain-db"]')
            (private / 'signing.keychain-db').write_text('temporary keychain')
            (root / 'mobile').mkdir()
            (root / 'mobile/config.json').write_text('{}')
            with patch.object(prepare.Path, 'home', return_value=root), \
                    patch.object(prepare.subprocess, 'run') as command:
                prepare.cleanup({'RUNNER_TEMP': directory}, root)
            command.assert_any_call(['security', 'list-keychains', '-d', 'user', '-s',
                                     'login.keychain-db'], check=True)
            command.assert_any_call(['security', 'delete-keychain', str(private / 'signing.keychain-db')], check=False)
            self.assertFalse(private.exists())
            self.assertFalse((root / 'mobile/config.json').exists())

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
                ('app.rephase.Rephase', '12', True, True),
                ('app.rephase.Other', '12', True, False),
                ('app.rephase.Rephase', '11', True, False),
                ('app.rephase.Rephase', '12', False, False),
            ]:
                with zipfile.ZipFile(path, 'w') as archive:
                    archive.writestr('Payload/Runner.app/Info.plist', plistlib.dumps({
                        'CFBundleIdentifier': bundle, 'CFBundleVersion': build,
                        'CFBundleShortVersionString': '0.1.0',
                        'CFBundleIcons': {'CFBundlePrimaryIcon': {'CFBundleIconName': 'AppIcon'}},
                    }))
                    archive.writestr('Payload/Runner.app/Assets.car', b'icons')
                    if profile:
                        archive.writestr('Payload/Runner.app/embedded.mobileprovision', b'profile')
                if valid:
                    self.assertEqual(len(verify.verify_ipa(path, '12', '0.1.0')), 64)
                else:
                    with self.assertRaises(ValueError):
                        verify.verify_ipa(path, '12', '0.1.0')


if __name__ == '__main__':
    unittest.main()
