import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rephase/data/models.dart';
import 'package:rephase/features/profile/membership_settings.dart';
import 'package:rephase/features/profile/preferences_editor.dart';

const programs = <Map<String, dynamic>>[
  {
    'id': 'united-mileageplus',
    'name': 'United MileagePlus',
    'airline': 'United Airlines',
    'keywords': ['UA', 'Premier', '1K', 'Star Alliance'],
    'tiers': [
      {'id': 'united-member', 'label': 'Member'},
      {'id': 'united-premier-gold', 'label': 'Premier Gold'},
      {'id': 'united-premier-1k', 'label': 'Premier 1K'},
    ],
  },
  {
    'id': 'qantas',
    'name': 'Qantas Frequent Flyer',
    'airline': 'Qantas',
    'tiers': [
      {'id': 'qantas-bronze', 'label': 'Bronze'},
      {'id': 'qantas-gold', 'label': 'Gold'},
      {'id': 'qantas-platinum', 'label': 'Platinum'},
    ],
  },
];

const memberships = <Map<String, dynamic>>[
  {'id': 'priority-pass', 'label': 'Priority Pass'},
  {'id': 'qantas-club', 'label': 'Qantas Club'},
];

void main() {
  testWidgets(
    'search airline keywords, select one tier, and preserve paid membership',
    (tester) async {
      var selected = <String>['priority-pass'];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) => SingleChildScrollView(
                child: MembershipSettings(
                  programs: programs,
                  memberships: memberships,
                  selected: selected,
                  onChanged: (value) => setState(() => selected = value),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Add airline status'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, '1K');
      await tester.pumpAndSettle();
      expect(find.text('United MileagePlus'), findsOneWidget);
      expect(find.text('Qantas Frequent Flyer'), findsNothing);
      await tester.tap(find.text('United MileagePlus'));
      await tester.pumpAndSettle();
      expect(selected, ['priority-pass', 'united-member']);
      await tester.tap(find.text('Member'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Premier 1K').last);
      await tester.pumpAndSettle();
      expect(selected, ['priority-pass', 'united-premier-1k']);
      await tester.tap(find.byTooltip('Remove United MileagePlus'));
      await tester.pumpAndSettle();
      expect(selected, ['priority-pass']);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'preference edits survive background refresh while untouched fields update',
    (tester) async {
      var preferences = Preferences.fromJson({
        'homeTimeZone': 'Australia/Sydney',
        'chronotype': 'intermediate',
        'usualBedtime': '23:00',
        'usualWakeTime': '07:00',
        'preferredBedtime': '23:00',
        'preferredWakeTime': '07:00',
        'sleepHours': 8,
        'sleepAnchor': 'wake',
        'caffeine': true,
        'melatonin': false,
        'melatoninAcknowledged': false,
        'preparationDays': 3,
        'loungeMemberships': ['priority-pass'],
        'futurePreference': 'preserved',
      });
      Preferences? saved;
      Widget app() => MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: PreferencesEditor(
                preferences: preferences,
                catalog: const {
                  'timeZones': ['Australia/Sydney', 'Pacific/Honolulu'],
                  'loyaltyPrograms': programs,
                  'memberships': memberships,
                },
                onSave: (value) async => saved = value,
              ),
            ),
          ),
        ),
      );
      await tester.pumpWidget(app());
      final melatonin = find.widgetWithText(
        SwitchListTile,
        'Melatonin guidance',
      );
      await tester.ensureVisible(melatonin);
      await tester.tap(melatonin);
      await tester.pumpAndSettle();
      preferences = preferences.withChanges({
        'homeTimeZone': 'Pacific/Honolulu',
      });
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      final save = find.widgetWithText(FilledButton, 'Save preferences');
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(saved?.melatonin, isTrue);
      expect(saved?.homeTimeZone, 'Pacific/Honolulu');
      expect(saved?.loungeMemberships, ['priority-pass']);
      expect(saved?.json['futurePreference'], 'preserved');
      expect(tester.takeException(), isNull);
    },
  );
}
