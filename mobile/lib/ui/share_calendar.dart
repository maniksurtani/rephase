import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../app_controller.dart';

Future<void> shareCalendar(
  BuildContext context,
  AppController controller,
) async {
  final trip = controller.selectedTrip;
  final plan = controller.mobilePlan?['plan'];
  if (trip == null || plan == null) return;
  try {
    final file = await controller.engineCall('calendar', {
      'trip': trip.toJson(),
      'plan': plan,
      'withAlarms': controller.preferences?.calendarAlarms ?? true,
    });
    if (!context.mounted) return;
    final box = context.findRenderObject() as RenderBox?;
    await SharePlus.instance.share(
      ShareParams(
        title: 'Rephase travel plan',
        files: [
          XFile.fromData(
            utf8.encode(file['contents'] as String),
            name: file['filename'] as String,
            mimeType: 'text/calendar',
          ),
        ],
        fileNameOverrides: [file['filename'] as String],
        sharePositionOrigin: box == null
            ? null
            : box.localToGlobal(Offset.zero) & box.size,
      ),
    );
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not share the calendar. Please try again.'),
        ),
      );
    }
  }
}
