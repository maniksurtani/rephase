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

const timeZones = <Map<String, dynamic>>[
  {'value': 'Australia/Sydney', 'city': 'Sydney'},
  {'value': 'Pacific/Honolulu', 'city': 'Honolulu'},
  {'value': 'America/Los_Angeles', 'city': 'Los Angeles'},
  {'value': 'UTC', 'city': 'Universal time'},
];

const _preferences = <String, dynamic>{
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
};

Widget _timeZoneApp({
  required Future<void> Function(Preferences) onSave,
  double headerHeight = 0,
}) => MaterialApp(
  home: Scaffold(
    appBar: AppBar(title: const Text('Your settings')),
    body: SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        children: [
          SizedBox(height: headerHeight),
          PreferencesEditor(
            preferences: Preferences.fromJson(_preferences),
            catalog: const {
              'timeZones': timeZones,
              'loyaltyPrograms': programs,
              'memberships': memberships,
            },
            onSave: onSave,
          ),
        ],
      ),
    ),
  ),
);

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
      var preferences = Preferences.fromJson(_preferences);
      Preferences? saved;
      Widget app() => MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: PreferencesEditor(
                preferences: preferences,
                catalog: const {
                  'timeZones': timeZones,
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

  testWidgets(
    'timezone suggestions narrow bridge records and save the selected IANA value',
    (tester) async {
      final saved = <Preferences>[];
      await tester.pumpWidget(
        _timeZoneApp(onSave: (value) async => saved.add(value)),
      );
      final field = find.byType(TextFormField).first;
      await tester.enterText(field, 'Syd');
      await tester.pumpAndSettle();
      expect(find.text('Australia/Sydney'), findsOneWidget);
      expect(find.text('Pacific/Honolulu'), findsNothing);

      await tester.enterText(field, 'Universal');
      await tester.pumpAndSettle();
      expect(find.text('UTC'), findsOneWidget);
      expect(find.text('Australia/Sydney'), findsNothing);

      await tester.enterText(field, 'Hono');
      await tester.pumpAndSettle();
      expect(find.text('Pacific/Honolulu'), findsOneWidget);
      expect(find.text('UTC'), findsNothing);
      await tester.tap(find.text('Pacific/Honolulu'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextFormField>(field).controller?.text,
        'Pacific/Honolulu',
      );
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      final save = find.widgetWithText(FilledButton, 'Save preferences');
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(saved, hasLength(1));
      expect(saved.single.homeTimeZone, 'Pacific/Honolulu');
      expect(saved.single.loungeMemberships, ['priority-pass']);
      expect(saved.single.json['futurePreference'], 'preserved');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a dismissed unmatched timezone search cannot save invalid text',
    (tester) async {
      final saved = <Preferences>[];
      await tester.pumpWidget(
        _timeZoneApp(onSave: (value) async => saved.add(value)),
      );
      await tester.enterText(
        find.byType(TextFormField).first,
        'Nowhere/Invalid',
      );
      await tester.pumpAndSettle();
      expect(find.text('Australia/Sydney'), findsNothing);
      expect(find.text('Pacific/Honolulu'), findsNothing);
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      expect(saved, isEmpty);
      final save = find.widgetWithText(FilledButton, 'Save preferences');
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(saved, isEmpty);
      expect(
        find.text('Choose a time zone from the suggestions.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'timezone options remain tappable above a compact-screen keyboard',
    (tester) async {
      tester.view.physicalSize = const Size(390, 780);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpWidget(
        _timeZoneApp(onSave: (_) async {}, headerHeight: 230),
      );
      final field = find.byType(TextFormField).first;
      await tester.tap(field);
      tester.view.viewInsets = const FakeViewPadding(bottom: 330);
      await tester.pumpAndSettle();
      await tester.enterText(field, 'Hono');
      await tester.pumpAndSettle();
      final option = find.text('Pacific/Honolulu');
      expect(option.hitTestable(), findsOneWidget);
      final optionRect = tester.getRect(option);
      final fieldRect = tester.getRect(field);
      expect(optionRect.bottom, lessThanOrEqualTo(fieldRect.top));
      expect(optionRect.top, greaterThanOrEqualTo(0));
      expect(optionRect.bottom, lessThan(780 - 330));
      await tester.tap(option);
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextFormField>(field).controller?.text,
        'Pacific/Honolulu',
      );
      expect(tester.takeException(), isNull);
    },
  );
}
