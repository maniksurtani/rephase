import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

String localDate(DateTime value) => DateFormat('yyyy-MM-dd').format(value);

String localMinute(DateTime value) =>
    DateFormat("yyyy-MM-dd'T'HH:mm").format(value);

DateTime? parseLocal(String? value) => DateTime.tryParse(value ?? '');

String scheduleLabel(Object? value) {
  final text = value?.toString() ?? '';
  return (text.length > 16 ? text.substring(0, 16) : text).replaceAll('T', ' ');
}

String airportLabel(Map<String, dynamic> airport) =>
    '${airport['city']} · ${airport['code']}';

Map<String, dynamic>? findAirport(
  List<Map<String, dynamic>> airports,
  String code,
) {
  for (final airport in airports) {
    if (airport['code'] == code) return airport;
  }
  return null;
}

/// Plain wall-clock values are kept as strings; the shared engine resolves DST.
class LocalDateTimeField extends StatelessWidget {
  const LocalDateTimeField({
    required this.label,
    required this.value,
    required this.onChanged,
    this.timeZone,
    this.dateOnly = false,
    super.key,
  });

  final String label;
  final String value;
  final String? timeZone;
  final bool dateOnly;
  final ValueChanged<String> onChanged;

  Future<void> _pick(BuildContext context) async {
    final current = parseLocal(value) ?? DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (date == null || !context.mounted) return;
    if (dateOnly) {
      onChanged(localDate(date));
      return;
    }
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: current.hour, minute: current.minute),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (time != null) {
      onChanged(
        localMinute(
          DateTime(date.year, date.month, date.day, time.hour, time.minute),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final date = parseLocal(value);
    final display = date == null
        ? 'Choose ${dateOnly ? 'date' : 'date and time'}'
        : DateFormat(
            dateOnly ? 'EEE d MMM yyyy' : 'EEE d MMM yyyy · HH:mm',
          ).format(date);
    return Semantics(
      button: true,
      label: '$label, $display',
      child: InkWell(
        onTap: () => _pick(context),
        borderRadius: BorderRadius.circular(12),
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            helperText: timeZone,
            suffixIcon: const Icon(Icons.calendar_today_outlined, size: 20),
          ),
          child: Text(display),
        ),
      ),
    );
  }
}

class AirportField extends StatelessWidget {
  const AirportField({
    required this.label,
    required this.code,
    required this.airports,
    required this.onSelected,
    super.key,
  });

  final String label;
  final String code;
  final List<Map<String, dynamic>> airports;
  final ValueChanged<Map<String, dynamic>> onSelected;

  @override
  Widget build(BuildContext context) {
    final selected = findAirport(airports, code);
    return Autocomplete<Map<String, dynamic>>(
      key: ValueKey('$label-$code'),
      initialValue: TextEditingValue(
        text: selected == null ? code : airportLabel(selected),
      ),
      displayStringForOption: airportLabel,
      optionsBuilder: (input) {
        final query = input.text.trim().toLowerCase();
        if (query.isEmpty) return const Iterable<Map<String, dynamic>>.empty();
        final matches = airports.where(
          (airport) =>
              '${airport['code']} ${airport['city']} ${airport['name']}'
                  .toLowerCase()
                  .contains(query),
        );
        final sorted = matches.toList()
          ..sort((a, b) {
            final exactA = a['code'].toString().toLowerCase() == query;
            final exactB = b['code'].toString().toLowerCase() == query;
            return exactA == exactB ? 0 : (exactA ? -1 : 1);
          });
        return sorted.take(12);
      },
      onSelected: onSelected,
      fieldViewBuilder: (context, controller, focusNode, submit) =>
          TextFormField(
            controller: controller,
            focusNode: focusNode,
            decoration: InputDecoration(
              labelText: label,
              hintText: 'City or airport code',
              helperText: selected?['timeZone']?.toString(),
            ),
            textCapitalization: TextCapitalization.words,
            onFieldSubmitted: (_) => submit(),
            validator: (value) {
              final typed = value?.trim().toLowerCase() ?? '';
              if (selected == null ||
                  (typed != code.toLowerCase() &&
                      typed != airportLabel(selected).toLowerCase())) {
                return 'Choose an airport from the suggestions.';
              }
              return null;
            },
          ),
      optionsViewBuilder: (context, select, options) => Align(
        alignment: Alignment.topLeft,
        child: Material(
          elevation: 8,
          borderRadius: BorderRadius.circular(12),
          clipBehavior: Clip.antiAlias,
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.sizeOf(context).width - 64,
              maxHeight: 280,
            ),
            child: ListView(
              padding: EdgeInsets.zero,
              shrinkWrap: true,
              children: [
                for (final airport in options)
                  ListTile(
                    title: Text(airportLabel(airport)),
                    subtitle: Text(airport['name'].toString()),
                    onTap: () => select(airport),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
