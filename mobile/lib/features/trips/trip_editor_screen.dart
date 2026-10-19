import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app_controller.dart';
import '../../data/models.dart';
import 'flight_leg_editor.dart';

class TripEditorScreen extends StatefulWidget {
  const TripEditorScreen({required this.controller, this.tripId, super.key});
  final AppController controller;
  final String? tripId;

  @override
  State<TripEditorScreen> createState() => _TripEditorScreenState();
}

class _TripEditorScreenState extends State<TripEditorScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _unresolved = <String>{};
  Map<String, dynamic>? _draft;
  String? _baseline;
  String? _accountId;
  bool _saving = false;
  bool _dirty = false;
  bool _allowPop = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _accountId = widget.controller.account?.json['id']?.toString();
    _initialize();
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Trip? _savedTrip() {
    for (final trip in widget.controller.trips) {
      if (trip.json['id'] == widget.tripId) return trip;
    }
    return null;
  }

  Future<void> _initialize() async {
    try {
      Map<String, dynamic> draft;
      if (widget.tripId != null) {
        final trip = _savedTrip();
        if (trip == null) throw StateError('This trip is no longer available.');
        draft = trip.toJson();
        _baseline = jsonEncode(draft);
      } else {
        final result = await widget.controller.engine.call('newTrip');
        draft = Map<String, dynamic>.from(result['trip'] as Map);
        for (final leg in draft['legs'] as List) {
          _unresolved.add((leg as Map)['id'].toString());
        }
      }
      if (!mounted) return;
      _name.text = draft['name']?.toString() ?? 'My next journey';
      setState(() {
        _draft = draft;
        _error = null;
        _dirty = false;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  List<Map<String, dynamic>> get _legs => (_draft!['legs'] as List)
      .map((leg) => Map<String, dynamic>.from(leg as Map))
      .toList();

  void _changeLeg(String id, Map<String, dynamic> next) {
    setState(() {
      _draft = {
        ..._draft!,
        'legs': [
          for (final leg in _legs)
            if (leg['id'] == id) next else leg,
        ],
      };
      _dirty = true;
      _error = null;
    });
  }

  Future<void> _addLeg() async {
    try {
      final result = await widget.controller.engine.call('newLeg');
      final leg = Map<String, dynamic>.from(result['leg'] as Map);
      if (!mounted) return;
      final legs = _legs;
      if (legs.isNotEmpty) {
        leg['departureAirport'] = legs.last['arrivalAirport'];
        leg['departureTimeZone'] = legs.last['arrivalTimeZone'];
        // Avoid placing a connection before the previous arrival by default.
        leg['departureDateTime'] = legs.last['arrivalDateTime'];
        leg['arrivalDateTime'] = legs.last['arrivalDateTime'];
      }
      setState(() {
        _draft = {
          ..._draft!,
          'legs': [...legs, leg],
        };
        _unresolved.add(leg['id'].toString());
        _dirty = true;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  void _move(int index, int direction) {
    final legs = _legs;
    final moved = legs.removeAt(index);
    legs.insert(index + direction, moved);
    setState(() {
      _draft = {..._draft!, 'legs': legs};
      _dirty = true;
    });
  }

  Future<void> _remove(String id) async {
    final remove = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove this flight?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (remove == true && mounted) {
      setState(() {
        _draft = {
          ..._draft!,
          'legs': _legs.where((leg) => leg['id'] != id).toList(),
        };
        _unresolved.remove(id);
        _dirty = true;
      });
    }
  }

  Future<void> _close() async {
    if (_saving) return;
    var discard = !_dirty;
    if (!discard) {
      discard =
          await showDialog<bool>(
            context: context,
            builder: (context) => AlertDialog(
              title: const Text('Discard changes?'),
              content: const Text(
                'Your changes to this trip have not been saved.',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('Keep editing'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: const Text('Discard'),
                ),
              ],
            ),
          ) ==
          true;
    }
    if (discard && mounted) {
      setState(() => _allowPop = true);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        if (context.canPop()) {
          context.pop();
        } else {
          context.go('/trips');
        }
      });
    }
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate() || _saving) return;
    if (_unresolved.isNotEmpty) {
      setState(
        () => _error =
            'Choose each flight from lookup results, or enter its schedule manually.',
      );
      return;
    }
    if (_accountId != widget.controller.account?.json['id']?.toString()) {
      setState(
        () => _error =
            'The account changed while this trip was open. Reopen the editor to continue.',
      );
      return;
    }
    if (widget.tripId != null &&
        jsonEncode(_savedTrip()?.toJson()) != _baseline) {
      setState(
        () => _error =
            'This trip changed on another screen or device. Reopen it before saving.',
      );
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    FocusScope.of(context).unfocus();
    try {
      final trip = Trip.fromJson({..._draft!, 'name': _name.text.trim()});
      await widget.controller.saveTrip(trip);
      if (mounted) {
        setState(() {
          _dirty = false;
          _allowPop = true;
        });
        context.go('/plan');
      }
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Bad state: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final airports = (widget.controller.catalog['airports'] as List? ?? [])
        .map((airport) => Map<String, dynamic>.from(airport as Map))
        .toList();
    return AnimatedBuilder(
      animation: widget.controller,
      builder: (context, _) => PopScope(
        canPop: _allowPop || (!_dirty && !_saving),
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) _close();
        },
        child: Scaffold(
          appBar: AppBar(
            title: Text(widget.tripId == null ? 'New trip' : 'Edit trip'),
            leading: IconButton(
              tooltip: 'Close trip editor',
              onPressed: _close,
              icon: const Icon(Icons.arrow_back),
            ),
          ),
          body: _draft == null
              ? Center(
                  child: _error == null
                      ? const CircularProgressIndicator()
                      : Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(_error!),
                        ),
                )
              : IgnorePointer(
                  ignoring: _saving,
                  child: Form(
                    key: _form,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                      children: [
                        const Text(
                          'Find each flight by number and departure date. Include connections in travel order.',
                        ),
                        const SizedBox(height: 20),
                        TextFormField(
                          controller: _name,
                          decoration: const InputDecoration(
                            labelText: 'Trip name',
                          ),
                          maxLength: 100,
                          textCapitalization: TextCapitalization.sentences,
                          onChanged: (_) => setState(() => _dirty = true),
                          validator: (value) =>
                              value == null || value.trim().isEmpty
                              ? 'Give your trip a name.'
                              : null,
                        ),
                        const SizedBox(height: 16),
                        for (final (index, leg) in _legs.indexed)
                          FlightLegEditor(
                            key: ValueKey(leg['id']),
                            controller: widget.controller,
                            leg: leg,
                            index: index,
                            count: _legs.length,
                            airports: airports,
                            onChanged: (next) =>
                                _changeLeg(leg['id'].toString(), next),
                            onResolved: (resolved) {
                              if (resolved) {
                                _unresolved.remove(leg['id'].toString());
                              } else {
                                _unresolved.add(leg['id'].toString());
                              }
                            },
                            onMove: (direction) => _move(index, direction),
                            onDelete: () => _remove(leg['id'].toString()),
                          ),
                        OutlinedButton.icon(
                          onPressed: _saving ? null : _addLeg,
                          icon: const Icon(Icons.add),
                          label: const Text('Add another flight'),
                        ),
                        if (_error != null)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            child: Text(
                              _error!,
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.error,
                              ),
                            ),
                          ),
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: _saving ? null : _save,
                          icon: _saving
                              ? const SizedBox.square(
                                  dimension: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.arrow_forward),
                          label: Text(_saving ? 'Saving…' : 'Create my plan'),
                        ),
                      ],
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}
