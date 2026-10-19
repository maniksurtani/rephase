import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app_controller.dart';
import 'preferences_editor.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  Future<void> _action(
    BuildContext context,
    Future<void> Function() action,
  ) async {
    try {
      await action();
    } catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$error')));
    }
  }

  Future<void> _delete(BuildContext context, AppController controller) async {
    final approved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete your Rephase account data?'),
        content: const Text(
          'This permanently removes your saved preferences and trips from Rephase '
          'and signs you out. Your Google account is unaffected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete data'),
          ),
        ],
      ),
    );
    if (approved == true && context.mounted) {
      await _action(context, () async {
        await controller.deleteAccountData();
        await controller.signOut();
      });
    }
  }

  Future<void> _export(BuildContext context, AppController controller) async {
    final data = controller.data;
    if (data == null) return;
    final bytes = Uint8List.fromList(
      utf8.encode(const JsonEncoder.withIndent('  ').convert(data.toJson())),
    );
    final box = context.findRenderObject() as RenderBox?;
    await _action(context, () async {
      await SharePlus.instance.share(
        ShareParams(
          title: 'Rephase data',
          files: [XFile.fromData(bytes, mimeType: 'application/json')],
          fileNameOverrides: const ['rephase-data.json'],
          sharePositionOrigin: box == null
              ? null
              : box.localToGlobal(Offset.zero) & box.size,
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    final preferences = controller.preferences;
    final account = controller.account;
    return Scaffold(
      appBar: AppBar(title: const Text('Your settings')),
      body: preferences == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
              children: [
                Text(
                  'Sleep, travel and lounge preferences, in one place.',
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 20),
                if (account != null)
                  Card(
                    child: ListTile(
                      leading: CircleAvatar(
                        foregroundImage:
                            account.picture == null || account.picture!.isEmpty
                            ? null
                            : NetworkImage(account.picture!),
                        child: const Icon(Icons.person_outline),
                      ),
                      title: Text(account.name),
                      subtitle: Text(account.email),
                      trailing: PopupMenuButton<String>(
                        tooltip: 'Account options',
                        onSelected: (_) => _action(context, controller.signOut),
                        itemBuilder: (_) => const [
                          PopupMenuItem(
                            value: 'signout',
                            child: Text('Sign out'),
                          ),
                        ],
                      ),
                    ),
                  )
                else
                  OutlinedButton.icon(
                    onPressed: controller.busy
                        ? null
                        : () => _action(context, controller.signIn),
                    icon: const Icon(Icons.account_circle_outlined),
                    label: const Text('Continue with Google'),
                  ),
                if (!controller.signedIn)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Guest data stays on this device. Sign in to use your saved account trips.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                if (controller.needsSignIn)
                  Card(
                    child: ListTile(
                      title: const Text('Reconnect your Google account'),
                      subtitle: const Text(
                        'Your session expired. Reconnect to save account changes.',
                      ),
                      trailing: const Icon(Icons.login),
                      onTap: controller.busy
                          ? null
                          : () => _action(context, controller.signIn),
                    ),
                  ),
                if (controller.conflicts.isNotEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Choose which changes to keep',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'This device and your account have conflicting edits. Export a copy below before replacing either version.',
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              OutlinedButton(
                                onPressed: controller.busy
                                    ? null
                                    : () => _action(
                                        context,
                                        () => controller.resolveConflict(
                                          useLocal: false,
                                        ),
                                      ),
                                child: const Text('Use account copy'),
                              ),
                              OutlinedButton(
                                onPressed: controller.busy
                                    ? null
                                    : () => _action(
                                        context,
                                        () => controller.resolveConflict(
                                          useLocal: true,
                                        ),
                                      ),
                                child: const Text('Keep device copy'),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                PreferencesEditor(
                  key: ValueKey(account?.id ?? 'guest'),
                  preferences: preferences,
                  catalog: controller.catalog,
                  busy: controller.busy,
                  onSave: controller.savePreferences,
                ),
                const SizedBox(height: 28),
                const Divider(),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.science_outlined),
                  title: const Text('The science behind your plan'),
                  trailing: const Icon(Icons.open_in_new, size: 18),
                  onTap: () => _action(context, () async {
                    final opened = await launchUrl(
                      Uri.parse('https://rephase.surtani.org/science.html'),
                      mode: LaunchMode.externalApplication,
                    );
                    if (!opened) {
                      throw StateError('Could not open the science guide.');
                    }
                  }),
                ),
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  leading: const Icon(Icons.privacy_tip_outlined),
                  title: const Text('Your data'),
                  children: [
                    ListTile(
                      leading: const Icon(Icons.ios_share),
                      title: const Text('Export preferences and trips'),
                      onTap: () => _export(context, controller),
                    ),
                    if (controller.signedIn)
                      ListTile(
                        leading: Icon(
                          Icons.delete_outline,
                          color: Theme.of(context).colorScheme.error,
                        ),
                        title: Text(
                          'Delete account data',
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                        onTap: controller.busy
                            ? null
                            : () => _delete(context, controller),
                      ),
                  ],
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.info_outline),
                  title: const Text('About Rephase'),
                  onTap: () => showAboutDialog(
                    context: context,
                    applicationName: 'Rephase',
                    applicationVersion: '0.1.0',
                    applicationIcon: const Icon(
                      Icons.bedtime_outlined,
                      size: 40,
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
