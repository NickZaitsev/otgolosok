/// Appends a further page without the items already shown (site `mergePage`).
List<T> mergePage<T>(List<T> current, List<T> incoming, String Function(T item) key) {
  final seen = current.map(key).toSet();
  return [...current, ...incoming.where((item) => seen.add(key(item)))];
}
