-- ReliefGrid: reference data required by every installation (urgency weights, parameters, categories)
USE reliefgrid;
SET NAMES utf8mb4;

INSERT INTO urgency_levels (level, label, weight, sla_hours) VALUES
  (1, 'Low',      1.0, 72),
  (2, 'Moderate', 2.0, 24),
  (3, 'High',     3.5, 12),
  (4, 'Critical', 6.0,  6);

INSERT INTO allocation_settings (setting_key, setting_value, description) VALUES
  ('vulnerability_weight',  1.0,  'Strength of the vulnerability factor: factor = 1 + weight x (vulnerable / population)'),
  ('aging_window_hours',    48.0, 'Hours of waiting after which the aging bonus is fully applied'),
  ('aging_max_bonus',       0.5,  'Maximum aging bonus: factor = 1 + bonus x min(1, hours_waiting / window)'),
  ('planning_horizon_days', 3.0,  'Days of supply a camp may request against a per-person standard'),
  ('road_detour_factor',    1.35, 'Road distance = straight-line distance x factor'),
  ('travel_speed_kmh',      30.0, 'Average convoy speed in flood conditions, used for ETA');

INSERT INTO supply_categories (name) VALUES
  ('Food'), ('Water'), ('Medical'), ('Shelter'), ('Hygiene'), ('Clothing'), ('Utilities');
