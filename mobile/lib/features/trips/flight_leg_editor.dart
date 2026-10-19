import 'package:flutter/material.dart';

import '../../app_controller.dart';
import 'flight_fields.dart';

class FlightLegEditor extends StatefulWidget {
  const FlightLegEditor({
    required this.controller,
    required this.leg,
    required this.index,
    required this.count,
    required this.airports,
    required this.onChanged,
    required this.onResolved,
    required this.onMove,
    required this.onDelete,
    super.key,
  });

  final AppController controller;
  final Map<String, dynamic> leg;
  final int index;
  final int count;
  final List<Map<String, dynamic>> airports;
  final ValueChanged<Map<String, dynamic>> onChanged;
  final ValueChanged<bool> onResolved;
  final ValueChanged<int> onMove;
  final VoidCallback onDelete;

  @override
  State<FlightLegEditor> createState() => _FlightLegEditorState();
}

class _FlightLegEditorState extends State<FlightLegEditor>
    with AutomaticKeepAliveClientMixin {
  late final TextEditingController _number;
  bool _manual = false;
  bool _busy = false;
  bool _arrivalEdited = false;
  late bool _resolved;
  int _request = 0;
  String? _error;
  Map<String, dynamic>? _result;
  final Map<String, Map<String, dynamic>> _localTimes = {};
  final Map<String, int> _localRequests = {};

  String _text(String key) => widget.leg[key]?.toString() ?? '';

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _number = TextEditingController(text: _text('flightNumber'));
    _resolved =
        _text('departureAirport').isNotEmpty &&
        _text('arrivalAirport').isNotEmpty;
    _arrivalEdited =
        _text('arrivalDateTime').isNotEmpty &&
        _text('arrivalDateTime') != _text('departureDateTime');
  }

  @override
  void dispose() {
    _request++;
    _number.dispose();
    super.dispose();
  }

  void _patch(Map<String, dynamic> patch, {bool schedule = false}) {
    final updated = {...widget.leg, ...patch};
    if (schedule) {
      for (final key in [
        'aircraft',
        'flightFetchedAt',
        'providerRecordConfirmed',
        'takeoffDateTime',
        'landingDateTime',
      ]) {
        updated.remove(key);
      }
      updated['flightSource'] = 'manual';
      if (patch.containsKey('departureDateTime') ||
          patch.containsKey('departureTimeZone')) {
        updated.remove('departureDisambiguation');
        _localTimes.remove('departure');
        _localRequests['departure'] = (_localRequests['departure'] ?? 0) + 1;
      }
      if (patch.containsKey('arrivalDateTime') ||
          patch.containsKey('arrivalTimeZone')) {
        updated.remove('arrivalDisambiguation');
        _localTimes.remove('arrival');
        _localRequests['arrival'] = (_localRequests['arrival'] ?? 0) + 1;
      }
    }
    widget.onChanged(updated);
  }

  void _queryChanged({String? number, String? date}) {
    _request++;
    setState(() {
      _result = null;
      _error = null;
      _busy = false;
      _resolved = _manual;
    });
    final patch = <String, dynamic>{};
    if (number != null) patch['flightNumber'] = number.toUpperCase().trim();
    if (date != null) {
      final previous = _text('departureDateTime');
      patch['departureDateTime'] =
          '$date${previous.length >= 16 ? previous.substring(10, 16) : 'T00:00'}';
      if (!_arrivalEdited) {
        patch['arrivalDateTime'] = patch['departureDateTime'];
      }
    }
    _patch(patch, schedule: true);
    widget.onResolved(_manual);
    if (_manual && date != null) {
      final next = {...widget.leg, ...patch}..remove('departureDisambiguation');
      _validateLocal('departure', next);
      if (patch.containsKey('arrivalDateTime')) {
        _validateLocal('arrival', next..remove('arrivalDisambiguation'));
      }
    }
  }

  Future<void> _lookup() async {
    final number = _number.text.trim();
    final departure = _text('departureDateTime');
    if (number.isEmpty || departure.length < 10) return;
    final request = ++_request;
    setState(() {
      _busy = true;
      _result = null;
      _error = null;
    });
    try {
      final result = await widget.controller.lookupFlight(
        number,
        departure.substring(0, 10),
      );
      if (mounted && request == _request) setState(() => _result = result);
    } catch (error) {
      if (mounted && request == _request) {
        setState(() => _error = error.toString());
      }
    } finally {
      if (mounted && request == _request) setState(() => _busy = false);
    }
  }

  void _apply(Map<String, dynamic> candidate) {
    final updated = {...widget.leg};
    for (final key in [
      'departureDisambiguation',
      'arrivalDisambiguation',
      'takeoffDateTime',
      'landingDateTime',
      'aircraft',
      'taxiOutMinutes',
      'taxiInMinutes',
    ]) {
      updated.remove(key);
    }
    for (final key in [
      'flightNumber',
      'departureAirport',
      'arrivalAirport',
      'departureDateTime',
      'arrivalDateTime',
      'departureTimeZone',
      'arrivalTimeZone',
      'aircraft',
      'departureDisambiguation',
      'arrivalDisambiguation',
      'takeoffDateTime',
      'landingDateTime',
    ]) {
      if (candidate[key] != null) updated[key] = candidate[key];
    }
    updated.addAll({
      'flightSource': 'aerodatabox',
      'flightFetchedAt': _result!['fetchedAt'],
      'providerRecordConfirmed': true,
    });
    _number.text = updated['flightNumber'].toString();
    _arrivalEdited = true;
    _localTimes.clear();
    for (final side in ['departure', 'arrival']) {
      _localRequests[side] = (_localRequests[side] ?? 0) + 1;
    }
    setState(() {
      _result = null;
      _manual = false;
      _resolved = true;
    });
    widget.onChanged(updated);
    widget.onResolved(true);
  }

  Future<void> _validateLocal(String side, Map<String, dynamic> leg) async {
    final value = leg['${side}DateTime']?.toString() ?? '';
    final zone = leg['${side}TimeZone']?.toString() ?? '';
    if (value.isEmpty ||
        zone.isEmpty ||
        leg['${side}Airport']?.toString().isEmpty != false) {
      return;
    }
    final request = (_localRequests[side] ?? 0) + 1;
    _localRequests[side] = request;
    try {
      final result = await widget.controller.engine.call('localTime', {
        'dateTime': value,
        'timeZone': zone,
        if (leg['${side}Disambiguation'] != null)
          'disambiguation': leg['${side}Disambiguation'],
      });
      if (mounted && _localRequests[side] == request) {
        setState(() => _localTimes[side] = result);
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  void _manualTime(String side, String value) {
    final patch = <String, dynamic>{'${side}DateTime': value};
    if (side == 'arrival') _arrivalEdited = true;
    if (side == 'departure' && !_arrivalEdited) {
      patch['arrivalDateTime'] = value;
    }
    _patch(patch, schedule: true);
    final next = {...widget.leg, ...patch}..remove('${side}Disambiguation');
    _validateLocal(side, next);
    if (patch.containsKey('arrivalDateTime') && side == 'departure') {
      _validateLocal('arrival', next);
    }
  }

  void _airport(String side, Map<String, dynamic> airport) {
    final patch = {
      '${side}Airport': airport['code'],
      '${side}TimeZone': airport['timeZone'],
    };
    _patch(patch, schedule: true);
    _validateLocal(
      side,
      {...widget.leg, ...patch}..remove('${side}Disambiguation'),
    );
  }

  Widget _fold(String side) {
    final result = _localTimes[side];
    if (result == null) return const SizedBox.shrink();
    if (result['ambiguous'] == true) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: DropdownButtonFormField<String>(
          initialValue: widget.leg['${side}Disambiguation'] as String?,
          isExpanded: true,
          decoration: const InputDecoration(
            labelText: 'Clock changes: which occurrence?',
          ),
          items: const [
            DropdownMenuItem(
              value: 'earlier',
              child: Text('Earlier occurrence'),
            ),
            DropdownMenuItem(value: 'later', child: Text('Later occurrence')),
          ],
          validator: (value) =>
              value == null ? 'Choose which occurrence of this time.' : null,
          onChanged: (value) {
            _patch({'${side}Disambiguation': value});
            _validateLocal(side, {
              ...widget.leg,
              '${side}Disambiguation': value,
            });
          },
        ),
      );
    }
    if (result['valid'] == false) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Text(
          result['error']?.toString() ??
              'This time does not exist. Choose another time.',
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      );
    }
    return const SizedBox.shrink();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final theme = Theme.of(context);
    final candidates = (_result?['candidates'] as List? ?? []).cast<Map>();
    final hasSchedule =
        _resolved &&
        _text('departureAirport').isNotEmpty &&
        _text('arrivalAirport').isNotEmpty;
    final aircraft = widget.leg['aircraft'] as Map?;
    return Card(
      margin: const EdgeInsets.only(bottom: 20),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(Icons.flight, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Flight ${widget.index + 1}',
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  tooltip: 'Move flight earlier',
                  onPressed: widget.index > 0 ? () => widget.onMove(-1) : null,
                  icon: const Icon(Icons.arrow_upward, size: 20),
                ),
                IconButton(
                  tooltip: 'Move flight later',
                  onPressed: widget.index + 1 < widget.count
                      ? () => widget.onMove(1)
                      : null,
                  icon: const Icon(Icons.arrow_downward, size: 20),
                ),
                IconButton(
                  tooltip: 'Remove flight',
                  onPressed: widget.count > 1 ? widget.onDelete : null,
                  icon: const Icon(Icons.delete_outline, size: 20),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _number,
              decoration: const InputDecoration(
                labelText: 'Flight number',
                hintText: 'e.g. QF 103',
              ),
              textCapitalization: TextCapitalization.characters,
              maxLength: 20,
              onChanged: (value) => _queryChanged(number: value),
              validator: (value) =>
                  !_manual &&
                      !hasSchedule &&
                      (value == null || value.trim().isEmpty)
                  ? 'Enter a flight number.'
                  : null,
            ),
            const SizedBox(height: 12),
            LocalDateTimeField(
              label: 'Departure date at the airport',
              value: _text('departureDateTime'),
              dateOnly: true,
              onChanged: (date) => _queryChanged(date: date),
            ),
            const SizedBox(height: 12),
            FilledButton.tonalIcon(
              onPressed:
                  !widget.controller.signedIn ||
                      !widget.controller.flightLookupAvailable ||
                      _busy ||
                      _number.text.trim().isEmpty ||
                      _text('departureDateTime').length < 10
                  ? null
                  : _lookup,
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.search),
              label: Text(_busy ? 'Looking up flight…' : 'Look up flight'),
            ),
            if (!widget.controller.signedIn)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Sign in to look up a flight, or enter it manually.',
                ),
              ),
            if (widget.controller.signedIn &&
                !widget.controller.flightLookupAvailable)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Flight lookup is unavailable. Enter your flight manually.',
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  _error!,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            if (_result != null) ...[
              const SizedBox(height: 12),
              if (_result!['stale'] == true)
                const Text('Cached schedule · updates unavailable'),
              if (candidates.isEmpty)
                const Text(
                  'No matching flight. Try the operating flight number or enter manually.',
                ),
              for (final candidate in candidates)
                _candidate(Map<String, dynamic>.from(candidate)),
            ],
            if (hasSchedule && !_manual) ...[
              const SizedBox(height: 12),
              Text(
                '${_text('departureAirport')} → ${_text('arrivalAirport')}',
                style: theme.textTheme.titleMedium,
              ),
              Text(
                '${scheduleLabel(_text('departureDateTime'))} → ${scheduleLabel(_text('arrivalDateTime'))}',
              ),
              if (aircraft?['model'] != null)
                Text('Aircraft · ${aircraft!['model']}'),
            ],
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () {
                  setState(() => _manual = !_manual);
                  if (_manual) {
                    _resolved = true;
                    widget.onResolved(true);
                    _validateLocal('departure', widget.leg);
                    _validateLocal('arrival', widget.leg);
                  }
                },
                child: Text(_manual ? 'Hide manual fields' : 'Enter manually'),
              ),
            ),
            if (_manual) ...[
              AirportField(
                label: 'Departure airport',
                code: _text('departureAirport'),
                airports: widget.airports,
                onSelected: (airport) => _airport('departure', airport),
              ),
              const SizedBox(height: 12),
              AirportField(
                label: 'Arrival airport',
                code: _text('arrivalAirport'),
                airports: widget.airports,
                onSelected: (airport) => _airport('arrival', airport),
              ),
              const SizedBox(height: 16),
              LocalDateTimeField(
                label: 'Departure',
                value: _text('departureDateTime'),
                timeZone: _text('departureAirport').isEmpty
                    ? null
                    : _text('departureTimeZone'),
                onChanged: (value) => _manualTime('departure', value),
              ),
              _fold('departure'),
              const SizedBox(height: 16),
              LocalDateTimeField(
                label: 'Arrival',
                value: _text('arrivalDateTime'),
                timeZone: _text('arrivalAirport').isEmpty
                    ? null
                    : _text('arrivalTimeZone'),
                onChanged: (value) => _manualTime('arrival', value),
              ),
              _fold('arrival'),
              const SizedBox(height: 16),
            ],
            DropdownButtonFormField<String>(
              initialValue: _text('travelClass').isEmpty
                  ? 'economy'
                  : _text('travelClass'),
              decoration: const InputDecoration(labelText: 'Travel class'),
              isExpanded: true,
              items: const [
                DropdownMenuItem(value: 'economy', child: Text('Economy')),
                DropdownMenuItem(
                  value: 'premium-economy',
                  child: Text('Premium economy'),
                ),
                DropdownMenuItem(value: 'business', child: Text('Business')),
                DropdownMenuItem(value: 'first', child: Text('First')),
              ],
              onChanged: (value) => _patch({'travelClass': value}),
            ),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              title: const Text('Lie-flat bed available'),
              value: widget.leg['lieFlat'] == true,
              onChanged: (value) => _patch({'lieFlat': value}),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _text('stayAfter').isEmpty
                  ? 'destination'
                  : _text('stayAfter'),
              decoration: const InputDecoration(labelText: 'After this flight'),
              isExpanded: true,
              items: const [
                DropdownMenuItem(
                  value: 'destination',
                  child: Text('Final Destination'),
                ),
                DropdownMenuItem(value: 'connection', child: Text('Transit')),
              ],
              onChanged: (value) => _patch({'stayAfter': value}),
            ),
            if (_text('stayAfter') != 'connection') ...[
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                initialValue: _text('strategy').isEmpty
                    ? 'adapt'
                    : _text('strategy'),
                decoration: const InputDecoration(
                  labelText: 'Adjustment Strategy',
                ),
                isExpanded: true,
                items: const [
                  DropdownMenuItem(
                    value: 'adapt',
                    child: Text('Adjust to destination'),
                  ),
                  DropdownMenuItem(
                    value: 'partial',
                    child: Text('Adjust partway'),
                  ),
                  DropdownMenuItem(
                    value: 'home',
                    child: Text('Keep home rhythm'),
                  ),
                ],
                onChanged: (value) => _patch({'strategy': value}),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _candidate(Map<String, dynamic> candidate) => Padding(
    padding: const EdgeInsets.only(top: 12),
    child: Card(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${candidate['flightNumber']} · ${candidate['airline']}',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            Text(
              '${candidate['departureAirport']} → ${candidate['arrivalAirport']}',
            ),
            Text(
              'Departs ${scheduleLabel(candidate['departureDateTime'])} (${candidate['departureTimeZone']})',
            ),
            Text(
              'Arrives ${scheduleLabel(candidate['arrivalDateTime'])} (${candidate['arrivalTimeZone']})',
            ),
            if ((candidate['aircraft'] as Map?)?['model'] != null)
              Text('Aircraft · ${(candidate['aircraft'] as Map)['model']}'),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => _apply(candidate),
              child: const Text('Use this flight'),
            ),
          ],
        ),
      ),
    ),
  );
}
