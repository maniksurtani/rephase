/// Small, immutable views of the shared schema-1 JSON contract.
///
/// Unknown fields survive edits so a newer web release can add fields without
/// an older installed app erasing them when it saves account state.
library;

import 'dart:convert' show jsonDecode, jsonEncode;

typedef Json = Map<String, dynamic>;

dynamic _freeze(dynamic value) => switch (value) {
  Map value => Map<String, dynamic>.unmodifiable(
    value.map((key, value) => MapEntry(key.toString(), _freeze(value))),
  ),
  List value => List<dynamic>.unmodifiable(value.map(_freeze)),
  _ => value,
};

Json jsonCopy(Json value) =>
    (jsonDecode(jsonEncode(value)) as Map).cast<String, dynamic>();

List<Json> jsonObjects(dynamic value) => value is List
    ? value
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList()
    : const [];

abstract class JsonModel {
  JsonModel(Json value) : json = _freeze(value) as Json;
  final Json json;
  Json toJson() => jsonCopy(json);
  String text(String key, [String fallback = '']) =>
      json[key] is String ? json[key] as String : fallback;
}

class Preferences extends JsonModel {
  Preferences.fromJson(super.value);
  Preferences withChanges(Json changes) =>
      Preferences.fromJson({...toJson(), ...changes});
  String get homeTimeZone => text('homeTimeZone', 'America/Los_Angeles');
  String get chronotype => text('chronotype', 'intermediate');
  String get usualBedtime => text('usualBedtime', '23:00');
  String get usualWakeTime => text('usualWakeTime', '07:00');
  String get preferredBedtime => text('preferredBedtime', '23:00');
  String get preferredWakeTime => text('preferredWakeTime', '07:00');
  String get sleepAnchor => text('sleepAnchor', 'wake');
  double get sleepHours => (json['sleepHours'] as num? ?? 8).toDouble();
  bool get caffeine => json['caffeine'] == true;
  bool get melatonin => json['melatonin'] == true;
  int get preparationDays => (json['preparationDays'] as num? ?? 3).toInt();
  String get planningMode => text('planningMode', 'model');
  bool get calendarAlarms => json['calendarAlarms'] != false;
  List<String> get loungeMemberships =>
      (json['loungeMemberships'] as List? ?? []).whereType<String>().toList();
  String get loungePriority => text('loungePriority', 'balanced');
}

class FlightLeg extends JsonModel {
  FlightLeg.fromJson(super.value);
  FlightLeg withChanges(Json changes) =>
      FlightLeg.fromJson({...toJson(), ...changes});
  String get id => text('id');
  String get flightNumber => text('flightNumber');
  String get departureAirport => text('departureAirport');
  String get arrivalAirport => text('arrivalAirport');
  String get departureDateTime => text('departureDateTime');
  String get arrivalDateTime => text('arrivalDateTime');
  String get departureTimeZone => text('departureTimeZone');
  String get arrivalTimeZone => text('arrivalTimeZone');
  String get stayAfter => text('stayAfter', 'destination');
  String get strategy => text('strategy', 'adapt');
  String get travelClass => text('travelClass', 'economy');
  bool get lieFlat => json['lieFlat'] == true;
  String? get aircraft => (json['aircraft'] as Map?)?['model'] as String?;
}

class Trip extends JsonModel {
  Trip.fromJson(super.value);
  Trip withChanges(Json changes) => Trip.fromJson({...toJson(), ...changes});
  String get id => text('id');
  String get name => text('name', 'My next journey');
  String get createdAt => text('createdAt');
  String get updatedAt => text('updatedAt');
  List<FlightLeg> get legs =>
      jsonObjects(json['legs']).map(FlightLeg.fromJson).toList();
  List<Json> get adherence => jsonObjects(json['adherence']);
}

const _unset = Object();

class AppData extends JsonModel {
  AppData.fromJson(super.value) {
    if (json['schemaVersion'] != 1 ||
        json['preferences'] is! Map ||
        json['trips'] is! List ||
        !(json['selectedTripId'] == null || json['selectedTripId'] is String)) {
      throw const FormatException(
        'Unsupported saved data. The copy was preserved.',
      );
    }
  }
  Preferences get preferences => Preferences.fromJson(
    (json['preferences'] as Map).cast<String, dynamic>(),
  );
  List<Trip> get trips =>
      jsonObjects(json['trips']).map(Trip.fromJson).toList();
  String? get selectedTripId => json['selectedTripId'] as String?;
  AppData copy({
    Preferences? preferences,
    List<Trip>? trips,
    Object? selectedTripId = _unset,
  }) => AppData.fromJson({
    ...toJson(),
    if (preferences != null) 'preferences': preferences.toJson(),
    if (trips != null) 'trips': trips.map((trip) => trip.toJson()).toList(),
    if (!identical(selectedTripId, _unset)) 'selectedTripId': selectedTripId,
  });
}

class Account extends JsonModel {
  Account.fromJson(super.value) {
    if (id.isEmpty ||
        id.length > 255 ||
        name.length > 200 ||
        email.length > 320) {
      throw const FormatException('Invalid account response.');
    }
  }
  String get id => text('id');
  String get name => text('name');
  String get email => text('email');
  String? get picture => json['picture'] as String?;
}

class CloudSnapshot {
  const CloudSnapshot({required this.data, required this.revision});
  factory CloudSnapshot.fromJson(Json json) {
    final revision = json['revision'];
    if (revision is! int || revision < 0) {
      throw const FormatException('Invalid account revision.');
    }
    return CloudSnapshot(
      data: json['data'] == null
          ? null
          : AppData.fromJson((json['data'] as Map).cast<String, dynamic>()),
      revision: revision,
    );
  }
  final AppData? data;
  final int revision;
  Json toJson() => {'data': data?.toJson(), 'revision': revision};
}

class CachedState {
  const CachedState({required this.data, this.baseline, this.pending = false});
  factory CachedState.fromJson(Json json) => CachedState(
    data: AppData.fromJson((json['data'] as Map).cast<String, dynamic>()),
    baseline: json['baseline'] is Map
        ? CloudSnapshot.fromJson(
            (json['baseline'] as Map).cast<String, dynamic>(),
          )
        : null,
    pending: json['pending'] == true,
  );
  final AppData data;
  final CloudSnapshot? baseline;
  final bool pending;
  Json toJson() => {
    'data': data.toJson(),
    'baseline': baseline?.toJson(),
    'pending': pending,
  };
}

class AccountSession {
  const AccountSession({
    required this.account,
    required this.token,
    required this.expiresAt,
  });
  factory AccountSession.fromJson(Json json) => AccountSession(
    account: Account.fromJson((json['account'] as Map).cast<String, dynamic>()),
    token: json['token'] as String,
    expiresAt: DateTime.parse(json['expiresAt'] as String).toUtc(),
  );
  final Account account;
  final String token;
  final DateTime expiresAt;
  bool validAt(DateTime now) =>
      expiresAt.isAfter(now.add(const Duration(seconds: 30)));
  Json toJson() => {
    'account': account.toJson(),
    'token': token,
    'expiresAt': expiresAt.toIso8601String(),
  };
}
