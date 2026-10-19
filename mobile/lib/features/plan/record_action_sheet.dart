import 'package:flutter/material.dart';

import '../../app_controller.dart';
import '../../data/models.dart';
import '../../ui/common.dart';

Future<void> showRecordActionSheet(
  BuildContext context,
  AppController controller,
  Json action,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (_) => _RecordActionSheet(controller: controller, action: action),
);

class _RecordActionSheet extends StatefulWidget {
  const _RecordActionSheet({required this.controller, required this.action});
  final AppController controller;
  final Json action;
  @override
  State<_RecordActionSheet> createState() => _RecordActionSheetState();
}

class _RecordActionSheetState extends State<_RecordActionSheet> {
  final _start = TextEditingController();
  final _end = TextEditingController();
  Json? _existing;
  late final String? _tripId;
  String _status = 'completed';
  String? _startChoice;
  String? _endChoice;
  String? _error;
  bool _loading = true;
  bool _saving = false;
  bool _startAmbiguous = false;
  bool _endAmbiguous = false;

  @override
  void initState() {
    super.initState();
    _tripId = widget.controller.selectedTrip?.id;
    _existing = widget.controller.selectedTrip?.adherence
        .where((item) => item['actionId'] == widget.action['id'])
        .firstOrNull;
    _status = labelOf(_existing ?? {}, 'status', 'completed');
    _prefill();
  }

  Future<void> _prefill() async {
    try {
      final clocks = await Future.wait([
        for (final side in ['start', 'end'])
          widget.controller.engineCall('clock', {
            'instant':
                _existing?[side == 'start' ? 'actualStart' : 'actualEnd'] ??
                widget.action[side],
            'timeZone': widget.action['timeZone'],
          }),
      ]);
      if (!mounted) return;
      _start.text = '${clocks[0]['dateKey']}T${clocks[0]['time']}';
      _end.text = '${clocks[1]['dateKey']}T${clocks[1]['time']}';
      _startChoice = clocks[0]['choice'] as String?;
      _endChoice = clocks[1]['choice'] as String?;
    } catch (error) {
      if (mounted) {
        _error = 'Could not load the local times. Close and try again.';
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final action = widget.action;
      final now = widget.controller.now;
      if (DateTime.parse(action['start'] as String).isAfter(now)) {
        throw const FormatException(
          'Record an activity after its scheduled start.',
        );
      }
      Json actual = {};
      if (_status != 'missed') {
        final results = await Future.wait([
          widget.controller.engineCall('localTime', {
            'dateTime': _start.text.trim(),
            'timeZone': action['timeZone'],
            if (_startChoice != null) 'disambiguation': _startChoice,
          }),
          widget.controller.engineCall('localTime', {
            'dateTime': _end.text.trim(),
            'timeZone': action['timeZone'],
            if (_endChoice != null) 'disambiguation': _endChoice,
          }),
        ]);
        if (!mounted) return;
        _startAmbiguous = results[0]['ambiguous'] == true;
        _endAmbiguous = results[1]['ambiguous'] == true;
        for (final result in results) {
          if (result['valid'] != true) {
            throw FormatException(
              labelOf(result, 'error', 'Check the local times.'),
            );
          }
        }
        final start = DateTime.parse(results[0]['iso'] as String);
        final end = DateTime.parse(results[1]['iso'] as String);
        if (!end.isAfter(start) ||
            end.isAfter(now.add(const Duration(minutes: 1)))) {
          throw const FormatException(
            'Record an interval that has ended, with the end after the start.',
          );
        }
        actual = {
          'actualStart': results[0]['iso'],
          'actualEnd': results[1]['iso'],
        };
      }
      await widget.controller.recordAction({
        'id':
            _existing?['id'] ??
            'record-${DateTime.now().microsecondsSinceEpoch}',
        'tripId': _tripId,
        'actionId': action['id'],
        'type': action['type'],
        'scheduledStart': action['start'],
        'scheduledEnd': action['end'],
        'timeZone': action['timeZone'],
        'status': _status,
        ...actual,
      });
      if (mounted) Navigator.of(context).pop();
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error is FormatException
              ? error.message
              : 'Could not save this record. Try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _start.dispose();
    _end.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(
      20,
      0,
      20,
      MediaQuery.viewInsetsOf(context).bottom + 20,
    ),
    child: SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Record what happened',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          Text(
            '${widget.action['title']} · ${widget.action['timeZone']}',
            style: const TextStyle(color: muted),
          ),
          const SizedBox(height: 20),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else ...[
            DropdownButtonFormField<String>(
              initialValue: _status,
              decoration: const InputDecoration(labelText: 'What happened?'),
              items: const [
                DropdownMenuItem(value: 'completed', child: Text('Completed')),
                DropdownMenuItem(
                  value: 'partial',
                  child: Text('Partly completed'),
                ),
                DropdownMenuItem(value: 'missed', child: Text('Missed')),
              ],
              onChanged: _saving
                  ? null
                  : (value) => setState(() => _status = value!),
            ),
            if (_status != 'missed') ...[
              const SizedBox(height: 16),
              _localField(_start, 'Actual start (local)', true),
              if (_startAmbiguous) _foldChoice(true),
              const SizedBox(height: 16),
              _localField(_end, 'Actual end (local)', false),
              if (_endAmbiguous) _foldChoice(false),
            ],
          ],
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _loading || _saving ? null : _save,
              child: Text(_saving ? 'Saving…' : 'Save record'),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _localField(
    TextEditingController controller,
    String label,
    bool start,
  ) => TextField(
    controller: controller,
    enabled: !_saving,
    readOnly: true,
    decoration: InputDecoration(
      labelText: label,
      suffixIcon: const Icon(Icons.calendar_today_outlined, size: 18),
    ),
    onTap: () async {
      // These are civil picker fields; only the shared engine resolves a zone.
      final initial =
          DateTime.tryParse(controller.text) ?? widget.controller.now;
      final date = await showDatePicker(
        context: context,
        initialDate: initial,
        firstDate: DateTime(2000),
        lastDate: DateTime(2100),
      );
      if (date == null || !mounted) return;
      final time = await showTimePicker(
        context: context,
        initialTime: TimeOfDay(hour: initial.hour, minute: initial.minute),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
          child: child!,
        ),
      );
      if (time == null || !mounted) return;
      String two(int value) => value.toString().padLeft(2, '0');
      setState(() {
        controller.text =
            '${date.year}-${two(date.month)}-${two(date.day)}T${two(time.hour)}:${two(time.minute)}';
        if (start) {
          _startChoice = null;
          _startAmbiguous = false;
        } else {
          _endChoice = null;
          _endAmbiguous = false;
        }
      });
    },
  );

  Widget _foldChoice(bool start) => Padding(
    padding: const EdgeInsets.only(top: 8),
    child: DropdownButtonFormField<String>(
      initialValue: start ? _startChoice : _endChoice,
      decoration: const InputDecoration(labelText: 'This time occurs twice'),
      items: const [
        DropdownMenuItem(value: 'earlier', child: Text('First occurrence')),
        DropdownMenuItem(value: 'later', child: Text('Second occurrence')),
      ],
      onChanged: (value) => setState(() {
        if (start) {
          _startChoice = value;
        } else {
          _endChoice = value;
        }
      }),
    ),
  );
}
