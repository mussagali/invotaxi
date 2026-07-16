import 'package:flutter/material.dart';

class Place {
  final String title;
  final String subtitle;
  final IconData icon;
  final String? uri;
  final double? lat;
  final double? lon;
  const Place(
    this.title,
    this.subtitle, {
    this.icon = Icons.place_outlined,
    this.uri,
    this.lat,
    this.lon,
  });

  String get displayName => subtitle.isEmpty ? title : '$title, $subtitle';
}

class Driver {
  final String name;
  final String car;
  final String plate;
  final double rating;
  const Driver({
    required this.name,
    required this.car,
    required this.plate,
    required this.rating,
  });
}

class Dependent {
  const Dependent({
    required this.id,
    required this.fullName,
    this.needsEscort = false,
    this.notes,
  });

  final String id;
  final String fullName;
  final bool needsEscort;
  final String? notes;

  factory Dependent.fromJson(Map<String, dynamic> json) => Dependent(
    id: json['id'] as String,
    fullName: json['full_name'] as String? ?? 'Ребёнок',
    needsEscort: json['needs_escort'] as bool? ?? false,
    notes: json['notes'] as String?,
  );
}

class OrderRequest {
  final String? backendId;
  final String status;
  final String from;
  final String to;
  final double? pickupLat;
  final double? pickupLon;
  final double? dropoffLat;
  final double? dropoffLon;
  final bool escort;
  final List<String> dependentIds;
  final DateTime? scheduledAt; // null => right now
  final String? comment;
  const OrderRequest({
    this.backendId,
    this.status = 'created',
    required this.from,
    required this.to,
    this.pickupLat,
    this.pickupLon,
    this.dropoffLat,
    this.dropoffLon,
    this.escort = false,
    this.dependentIds = const [],
    this.scheduledAt,
    this.comment,
  });

  bool get isScheduled => scheduledAt != null;
}

class TripHistoryItem {
  final String id; // e.g. "№84-RP"
  final String dateLabel; // "Сегодня · 14:32"
  final String from;
  final String to;
  final int minutes;
  final double distanceKm;
  final bool escort;
  final String status; // "Завершено"
  const TripHistoryItem({
    required this.id,
    required this.dateLabel,
    required this.from,
    required this.to,
    required this.minutes,
    required this.distanceKm,
    this.escort = false,
    this.status = 'Завершено',
  });
}

class ChatMessage {
  final String text;
  final String time;
  final bool mine;
  const ChatMessage(this.text, this.time, {this.mine = false});
}

class AppNotification {
  final IconData icon;
  final String title;
  final String body;
  final bool highlighted;
  const AppNotification({
    required this.icon,
    required this.title,
    required this.body,
    this.highlighted = false,
  });
}

class FaqItem {
  final String question;
  final String answer;
  const FaqItem(this.question, this.answer);
}

class ComplaintType {
  final String title;
  final String subtitle;
  const ComplaintType(this.title, this.subtitle);
}

class DriverOrder {
  final String backendId;
  final String status;
  final String passenger;
  final String timeLabel; // "Сегодня, 14:30"
  final String from;
  final String to;
  final bool escort;
  const DriverOrder({
    required this.backendId,
    required this.status,
    required this.passenger,
    required this.timeLabel,
    required this.from,
    required this.to,
    this.escort = false,
  });
}
