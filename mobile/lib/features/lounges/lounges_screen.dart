import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app_controller.dart';
import '../../data/models.dart';

class LoungesScreen extends StatefulWidget {
  const LoungesScreen({super.key, this.airport, this.legId});
  final String? airport;
  final String? legId;

  @override
  State<LoungesScreen> createState() => _LoungesScreenState();
}

class _LoungesScreenState extends State<LoungesScreen> {
  String _airport = 'SFO';
  Json _visit = {};
  Json? _flightContext;
  Json? _result;
  String? _error;
  bool _loading = true;
  bool _started = false;
  bool _showClockChoices = false;
  int _request = 0;
  String _membershipSignature = '';

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final controller = context.watch<AppController>();
    if (!_started &&
        controller.preferences != null &&
        controller.catalog.isNotEmpty) {
      _started = true;
      WidgetsBinding.instance.addPostFrameCallback((_) => _initialize());
    }
    final signature = jsonEncode({
      'account': controller.account?.id,
      'memberships': controller.preferences?.loungeMemberships,
      'priority': controller.preferences?.loungePriority,
    });
    if (_membershipSignature.isNotEmpty &&
        signature != _membershipSignature &&
        _visit.isNotEmpty &&
        controller.preferences != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _search();
      });
    }
    _membershipSignature = signature;
  }

  @override
  void didUpdateWidget(LoungesScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.airport != widget.airport ||
        oldWidget.legId != widget.legId) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _initialize());
    }
  }

  Future<void> _initialize({String? airport}) async {
    if (!mounted) return;
    final controller = context.read<AppController>();
    final request = ++_request;
    setState(() {
      _loading = true;
      _error = null;
      _result = null;
      _showClockChoices = false;
    });
    try {
      final contexts = jsonObjects(controller.mobilePlan?['loungeContexts']);
      _flightContext = airport != null
          ? null
          : contexts
                .where((value) => value['legId'] == widget.legId)
                .firstOrNull;
      final code =
          airport ??
          widget.airport ??
          (_flightContext?['airport'] as String?) ??
          'SFO';
      final response = await controller.engineCall('loungeVisit', {
        'airport': code,
        if (_flightContext != null) 'flightContext': _flightContext,
        'now': controller.now.millisecondsSinceEpoch,
      });
      if (!mounted || request != _request) return;
      setState(() {
        _airport = code;
        _visit = response;
        _loading = false;
      });
      if (response['airportData'] != null &&
          '${response['from'] ?? ''}'.isNotEmpty &&
          '${response['until'] ?? ''}'.isNotEmpty) {
        await _search();
      }
    } catch (error) {
      if (!mounted || request != _request) return;
      setState(() {
        _error = '$error';
        _loading = false;
      });
    }
  }

  Future<void> _search() async {
    if (!mounted) return;
    final controller = context.read<AppController>();
    if (controller.preferences == null) return;
    final request = ++_request;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await controller.exploreLounges({
        'airport': _airport,
        'preferences': controller.preferences?.toJson(),
        if (_flightContext != null) 'flightContext': _flightContext,
        for (final key in [
          'date',
          'from',
          'until',
          'departureTime',
          'fromChoice',
          'untilChoice',
          'departureChoice',
          'cabin',
          'operatingCarrier',
          'marketingCarrier',
          'route',
          'terminal',
          'destinationCountry',
        ])
          if (_visit[key] != null && _visit[key] != '') key: _visit[key],
        'now': controller.now.millisecondsSinceEpoch,
      });
      if (!mounted || request != _request) return;
      setState(() {
        _result = result;
        _error = result['error'] as String?;
        _showClockChoices =
            _showClockChoices || (_error?.contains('occurs twice') ?? false);
        _loading = false;
      });
    } catch (error) {
      if (!mounted || request != _request) return;
      setState(() {
        _error = '$error';
        _loading = false;
      });
    }
  }

  void _change(String key, String? value) => setState(() {
    _visit[key] = value;
    _result = null;
    _error = null;
  });

  Future<void> _chooseAirport() async {
    final controller = context.read<AppController>();
    final airport = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => _AirportPicker(
        airports: jsonObjects(controller.catalog['airports']),
        coverage: controller.catalog['loungeAirports'] as List? ?? const [],
      ),
    );
    if (airport != null && mounted) await _initialize(airport: airport);
  }

  Future<void> _date() async {
    final initial = DateTime.tryParse('${_visit['date']}') ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(initial.year - 1),
      lastDate: DateTime(initial.year + 3),
    );
    if (picked == null || !mounted) return;
    _change(
      'date',
      '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}',
    );
    _visit.remove('fromChoice');
    _visit.remove('untilChoice');
    _visit.remove('departureChoice');
  }

  Future<void> _time(String key) async {
    final parts = '${_visit[key] ?? '10:00'}'.split(':');
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(
        hour: int.tryParse(parts.first) ?? 10,
        minute: parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0,
      ),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (picked == null || !mounted) return;
    _change(
      key,
      '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}',
    );
    _visit.remove(switch (key) {
      'from' => 'fromChoice',
      'until' => 'untilChoice',
      _ => 'departureChoice',
    });
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    final airport = jsonObjects(
      controller.catalog['airports'],
    ).where((value) => value['code'] == _airport).firstOrNull;
    final airlineOptions = <String, String>{'': 'Not specified'};
    for (final value in controller.catalog['airlines'] as List? ?? const []) {
      if (value is List && value.length >= 2) {
        airlineOptions['${value[0]}'] = '${value[1]}';
      }
      if (value is Map) {
        airlineOptions['${value['code']}'] =
            '${value['name'] ?? value['label']}';
      }
    }
    final saved = controller.preferences?.loungeMemberships ?? const <String>[];
    final labels = jsonObjects(controller.catalog['memberships'])
        .where((value) => saved.contains(value['id']))
        .map((value) => '${value['label']}')
        .toList();
    final results = jsonObjects(_result?['results']);
    final data = (_result?['airportData'] ?? _visit['airportData']) as Map?;
    final zone =
        '${_result?['timeZone'] ?? _visit['timeZone'] ?? airport?['timeZone'] ?? ''}';
    final terminals = (_visit['terminals'] as List? ?? const [])
        .whereType<String>()
        .toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Lounge Explorer')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Text(
            'Find a place to shower, eat or unwind before your flight.',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const SizedBox(height: 20),
          if (_flightContext != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${_flightContext!['kind'] == 'transit' ? 'Your transit' : 'Before your flight'} · ${_flightContext!['flightNumber']}',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (_flightContext!['note'] != null) ...[
                      const SizedBox(height: 6),
                      Text('${_flightContext!['note']}'),
                    ],
                  ],
                ),
              ),
            ),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.local_airport),
                  title: Text(
                    '$_airport · ${airport?['city'] ?? airport?['name'] ?? 'Choose airport'}',
                  ),
                  subtitle: const Text('Airport'),
                  trailing: const Icon(Icons.expand_more),
                  onTap: _chooseAirport,
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.calendar_today_outlined),
                  title: Text('${_visit['date'] ?? 'Choose visit date'}'),
                  subtitle: const Text('Visit date at the airport'),
                  onTap: _date,
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final field in const {
                        'from': 'From',
                        'until': 'Until',
                        'departureTime': 'Departure',
                      }.entries)
                        OutlinedButton(
                          onPressed: () => _time(field.key),
                          child: Text(
                            '${field.value} · ${_visit[field.key] ?? 'Set time'}',
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'All times at the airport${zone.isEmpty ? '' : ' · ${zone.replaceAll('_', ' ')}'}.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (_showClockChoices) ...[
            const SizedBox(height: 12),
            const Text(
              'A clock time repeats when daylight saving ends. Choose its first or second occurrence.',
            ),
            const SizedBox(height: 12),
            for (final field in const {
              'fromChoice': 'Visit start',
              'untilChoice': 'Visit end',
              'departureChoice': 'Departure',
            }.entries) ...[
              _choice(field.key, field.value, const {
                '': 'Choose for a repeated time',
                'earlier': 'First occurrence',
                'later': 'Second occurrence',
              }),
              const SizedBox(height: 12),
            ],
          ],
          const SizedBox(height: 12),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: const Text('Your departing flight'),
            initiallyExpanded: true,
            children: [
              _choice('operatingCarrier', 'Operating airline', {
                ...airlineOptions,
                '': 'Confirm airline',
              }),
              const SizedBox(height: 12),
              _choice(
                'marketingCarrier',
                'Airline on your flight number',
                airlineOptions,
              ),
              const SizedBox(height: 12),
              _choice('cabin', 'Travel class', const {
                'economy': 'Economy',
                'premium-economy': 'Premium economy',
                'business': 'Business',
                'first': 'First',
              }),
              const SizedBox(height: 12),
              _choice('route', 'Route', const {
                'international': 'International',
                'domestic': 'Domestic',
              }),
              const SizedBox(height: 12),
              _choice('terminal', 'Departure terminal', {
                '': 'Check terminal access',
                for (final terminal in terminals) terminal: terminal,
              }),
              const SizedBox(height: 12),
            ],
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.card_membership),
            title: Text(
              labels.isEmpty
                  ? 'No lounge memberships saved'
                  : labels.join(' · '),
            ),
            subtitle: const Text('Edit memberships in your settings'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.go('/profile'),
          ),
          FilledButton.icon(
            onPressed: _loading ? null : _search,
            icon: _loading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.search),
            label: Text(_loading ? 'Checking lounges…' : 'Find lounges'),
          ),
          const SizedBox(height: 20),
          if (!_loading && data == null)
            _Message(
              text:
                  'We haven’t researched lounges at $_airport yet. '
                  'Current coverage: ${(controller.catalog['loungeAirports'] as List? ?? []).map((value) => value is Map ? value['airport'] : value).join(', ')}.',
            )
          else if (_error != null)
            _Message(text: _error!, error: true)
          else if (!_loading && _result == null)
            const _Message(
              text: 'Set your visit times to check access and opening hours.',
            ),
          if (_result != null && _error == null) ...[
            Text(
              '${airport?['city'] ?? _airport} lounges',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 4),
            Text(
              '${results.length} researched lounges${data?['updatedAt'] == null ? '' : ' · reviewed ${data!['updatedAt']}'}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (_result!['recommendedId'] == null)
              const Padding(
                padding: EdgeInsets.only(top: 12),
                child: Text(
                  'No confirmed match fits this visit. Check the conditional options and confirm your airline and terminal.',
                ),
              ),
            const SizedBox(height: 12),
            for (final result in results) LoungeResultCard(result: result),
          ],
          const SizedBox(height: 16),
          Text(
            'A curated guide. Guest access, capacity and paid extras follow each program’s rules.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _choice(String key, String label, Map<String, String> options) {
    final current = '${_visit[key] ?? ''}';
    return DropdownButtonFormField<String>(
      key: ValueKey('$_airport-$key-$current'),
      initialValue: options.containsKey(current) ? current : null,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final option in options.entries)
          DropdownMenuItem(
            value: option.key,
            child: Text(option.value, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (value) => _change(key, value),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.text, this.error = false});
  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) => Card(
    color: error ? Theme.of(context).colorScheme.errorContainer : null,
    child: Padding(padding: const EdgeInsets.all(16), child: Text(text)),
  );
}

/// Pure result presentation: eligibility and ranking stay in the shared engine.
class LoungeResultCard extends StatelessWidget {
  const LoungeResultCard({super.key, required this.result});
  final Json result;

  Future<void> _open(BuildContext context, String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null || uri.scheme != 'https') return;
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (opened) return;
    } catch (_) {
      // Some devices do not have a browser registered for external links.
    }
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open this source.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final lounge = (result['lounge'] as Map).cast<String, dynamic>();
    final amenities = (lounge['amenities'] as Map? ?? const {});
    final recommended = result['recommended'] == true;
    final hours = lounge['hours'] as Map?;
    final reasons = (result['reasons'] as List? ?? const [])
        .whereType<String>();
    final warnings = (result['warnings'] as List? ?? const [])
        .whereType<String>();
    final sources = jsonObjects(lounge['sources']);
    final photos = jsonObjects(lounge['photos']);
    final access = switch (result['access']) {
      'eligible' => 'Access matches',
      'conditional' => 'Conditional access',
      _ => 'Access does not match',
    };
    final opening = switch (result['opening']) {
      'open' => 'Open for your visit',
      'closed' => 'Closed for your visit',
      _ => 'Confirm opening hours',
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: recommended
          ? RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
              side: BorderSide(color: Theme.of(context).colorScheme.primary),
            )
          : null,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (recommended) ...[
              Row(
                children: [
                  Icon(
                    Icons.auto_awesome,
                    size: 16,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Recommended',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
            ],
            Text(
              '${lounge['name']}',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 4),
            Text(
              '${lounge['terminal']} · ${lounge['airside'] == true ? 'Airside' : 'Landside'}',
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _chip(Icons.verified_outlined, access),
                _chip(Icons.schedule, opening),
                if (amenities['showers'] == 'yes')
                  _chip(Icons.shower_outlined, 'Showers'),
                if (amenities['dining'] == 'restaurant')
                  _chip(Icons.restaurant, 'Restaurant'),
                if (amenities['dining'] == 'buffet')
                  _chip(Icons.restaurant_menu, 'Buffet'),
                if (amenities['dining'] == 'snacks')
                  _chip(Icons.local_cafe_outlined, 'Snacks'),
                if (amenities['spa'] == 'yes') _chip(Icons.spa_outlined, 'Spa'),
                if (amenities['quietArea'] == 'yes')
                  _chip(Icons.self_improvement, 'Quiet area'),
                if (amenities['wifi'] == 'yes') _chip(Icons.wifi, 'Wi-Fi'),
              ],
            ),
            if (result['recommendationReason'] != null) ...[
              const SizedBox(height: 12),
              Text('${result['recommendationReason']}'),
            ],
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              childrenPadding: const EdgeInsets.only(bottom: 8),
              title: const Text('Access, hours & details'),
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${lounge['location']}'),
                      const SizedBox(height: 12),
                      for (final message in [...reasons, ...warnings])
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Text(message),
                        ),
                      if (hours?['note'] != null) Text('${hours!['note']}'),
                      for (final period in jsonObjects(hours?['periods']))
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(
                            '${_days(period['days'])} · ${period['open']}–${period['close']}',
                          ),
                        ),
                      if (lounge['note'] != null) ...[
                        const SizedBox(height: 12),
                        Text('${lounge['note']}'),
                      ],
                      if (photos.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        for (final photo in photos)
                          if (photo['path'] is String) ...[
                            ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: Image.network(
                                Uri.parse(
                                  'https://rephase.surtani.org/',
                                ).resolve('${photo['path']}').toString(),
                                fit: BoxFit.cover,
                                semanticLabel:
                                    '${photo['alt'] ?? lounge['name']}',
                                errorBuilder: (_, _, _) =>
                                    const SizedBox.shrink(),
                              ),
                            ),
                            Text(
                              '${photo['credit']} · ${photo['license']}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                      ],
                      for (final source in sources)
                        TextButton.icon(
                          onPressed: () => _open(context, '${source['url']}'),
                          icon: const Icon(Icons.open_in_new, size: 14),
                          label: Text('${source['title']}', softWrap: true),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(IconData icon, String label) => Chip(
    avatar: Icon(icon, size: 16),
    label: Text(label),
    visualDensity: VisualDensity.compact,
  );

  String _days(Object? value) {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    if (value is! List) return '';
    if (value.length == 7) return 'Daily';
    return value
        .whereType<int>()
        .where((day) => day >= 1 && day <= 7)
        .map((day) => labels[day - 1])
        .join(', ');
  }
}

class _AirportPicker extends StatefulWidget {
  const _AirportPicker({required this.airports, required this.coverage});
  final List<Json> airports;
  final List<dynamic> coverage;

  @override
  State<_AirportPicker> createState() => _AirportPickerState();
}

class _AirportPickerState extends State<_AirportPicker> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final covered = widget.coverage
        .map((value) => value is Map ? value['airport'] : value)
        .toSet();
    final airports = widget.airports
        .where((airport) {
          if (_query.trim().isEmpty) return covered.contains(airport['code']);
          return '${airport['code']} ${airport['city']} ${airport['name']}'
              .toLowerCase()
              .contains(_query.trim().toLowerCase());
        })
        .take(50);
    return FractionallySizedBox(
      heightFactor: 0.85,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          16,
          0,
          16,
          MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Choose an airport',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            TextField(
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Airport code or city',
                prefixIcon: Icon(Icons.search),
              ),
              onChanged: (value) => setState(() => _query = value),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: airports.isEmpty
                  ? const Center(child: Text('No matching airports.'))
                  : ListView(
                      children: [
                        for (final airport in airports)
                          ListTile(
                            title: Text(
                              '${airport['code']} · ${airport['city'] ?? airport['name']}',
                            ),
                            subtitle: Text('${airport['name']}'),
                            trailing: covered.contains(airport['code'])
                                ? const Icon(Icons.chair_outlined)
                                : null,
                            onTap: () =>
                                Navigator.pop(context, '${airport['code']}'),
                          ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
