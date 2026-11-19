import { useMemo } from 'react';

const days = [
  { name: 'Mon', day: 'Monday' },
  { name: 'Tue', day: 'Tuesday' },
  { name: 'Wed', day: 'Wednesday' },
  { name: 'Thu', day: 'Thursday' },
  { name: 'Fri', day: 'Friday' },
  { name: 'Sat', day: 'Saturday' },
  { name: 'Sun', day: 'Sunday' },
];

const parseSchedule = (schedule) => {
  const text = typeof schedule === 'string' ? schedule : '';
  const selectedDays = days
    .filter(({ name, day }) => new RegExp(`\\b(?:${name}|${day})\\b`, 'i').test(text))
    .map(({ name }) => name);
  const range = text.match(/(\d{1,2}):(\d{2})\s*(?:-|to|–)\s*(\d{1,2}):(\d{2})/i);
  return {
    selectedDays,
    startTime: range ? `${range[1].padStart(2, '0')}:${range[2]}` : '09:00',
    endTime: range ? `${range[3].padStart(2, '0')}:${range[4]}` : '10:30',
  };
};

const formatSchedule = (selectedDays, startTime, endTime) => (
  selectedDays.length ? `${days.filter(({ name }) => selectedDays.includes(name)).map(({ name }) => name).join(', ')} ${startTime}-${endTime}` : ''
);

export default function CohortTimetableFields({ schedule = '', onChange, timezone = 'UTC' }) {
  const parsed = useMemo(() => parseSchedule(schedule), [schedule]);
  const invalidDuration = parsed.endTime <= parsed.startTime;

  const setTime = (key, value) => {
    const next = { ...parsed, [key]: value };
    onChange(formatSchedule(next.selectedDays, next.startTime, next.endTime));
  };

  const toggleDay = (day) => {
    const selectedDays = parsed.selectedDays.includes(day)
      ? parsed.selectedDays.filter((selected) => selected !== day)
      : [...parsed.selectedDays, day];
    onChange(formatSchedule(selectedDays, parsed.startTime, parsed.endTime));
  };

  return (
    <fieldset className="timetable-fields">
      <legend>Weekly class timetable</legend>
      <span className="field-hint">Choose the days and local class time. Timezone: {timezone}.</span>
      <div className="timetable-days">
        {days.map(({ name, day }) => (
          <label key={name}>
            <input
              type="checkbox"
              checked={parsed.selectedDays.includes(name)}
              onChange={() => toggleDay(name)}
            />
            {name}
            <span className="sr-only">{day}</span>
          </label>
        ))}
      </div>
      <div className="timetable-times">
        <label className="form-field">
          <span>Starts</span>
          <input type="time" value={parsed.startTime} onChange={(event) => setTime('startTime', event.target.value)} />
        </label>
        <label className="form-field">
          <span>Ends</span>
          <input type="time" value={parsed.endTime} onChange={(event) => setTime('endTime', event.target.value)} />
        </label>
      </div>
      {invalidDuration && <span className="field-error" role="alert">Class end time must be after its start time.</span>}
    </fieldset>
  );
}
