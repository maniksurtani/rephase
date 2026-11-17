import 'package:rephase/data/lounge_repository.dart';
import 'package:rephase/data/models.dart';

/// UI/controller tests use deterministic content; repository IO has its own tests.
class MemoryLoungeRepository extends LoungeRepository {
  MemoryLoungeRepository() : super(validate: (_, _) async => {});
  @override
  Future<LoungeGuide> load(String airport) async =>
      LoungeGuide('ready', {'airport': airport, 'lounges': <Json>[]});
  @override
  Future<void> prefetch(List<String> airports) async {}
}
