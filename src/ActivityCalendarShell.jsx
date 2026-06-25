import React from 'react';
import {
  DOW,
  MONTHS,
  buildMonthCells,
  calendarTitle,
  fmtYmd,
  indexTasksByYmd,
  todayYmd,
  weekCellDates,
} from './activityCalendarUtils.js';
import './activityCalendar.css';

const VIEWS = ['day', 'week', 'month', 'year'];

export function ActivityCalendarShell({
  eyebrow = 'Activities',
  view = 'month',
  cursorDate,
  selectedYmd,
  tasks = [],
  getTaskYmd,
  getTaskId,
  getTaskTitle,
  getTaskColor,
  onViewChange,
  onCursorChange,
  onToday,
  onSelectDay,
  onTaskClick,
  legend = [],
}) {
  const title = calendarTitle(view, cursorDate);
  const today = todayYmd();
  const byDay = indexTasksByYmd(tasks, getTaskYmd);

  const renderEvent = (task) => (
    <div
      key={getTaskId(task)}
      className="hr-cal-ev"
      style={{ background: getTaskColor(task) }}
      title={getTaskTitle(task)}
      onClick={(e) => {
        e.stopPropagation();
        onTaskClick?.(task);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onTaskClick?.(task); }}
    >
      {getTaskTitle(task)}
    </div>
  );

  let body = null;
  if (view === 'month') {
    const cells = buildMonthCells(cursorDate);
    body = (
      <div className="hr-cal-month">
        {DOW.map((w) => <div key={w} className="hr-cal-dow">{w}</div>)}
        {cells.map((cell) => {
          const evs = byDay.get(cell.ymd) || [];
          const isSelected = selectedYmd === cell.ymd;
          return (
            <div
              key={cell.ymd}
              className={`hr-cal-day${cell.inMonth ? '' : ' other'}${cell.ymd === today ? ' today' : ''}${isSelected ? ' selected' : ''}`}
              onClick={() => onSelectDay?.(cell.ymd)}
              role="button"
              tabIndex={0}
            >
              <div className="hr-cal-day-num">{cell.date.getDate()}</div>
              {evs.slice(0, 3).map(renderEvent)}
              {evs.length > 3 ? <div className="hr-cal-more">+{evs.length - 3} more</div> : null}
            </div>
          );
        })}
      </div>
    );
  } else if (view === 'week') {
    const days = weekCellDates(cursorDate);
    body = (
      <div className="hr-cal-week">
        <div className="hr-cal-dow hr-cal-week-corner" />
        {days.map((day) => (
          <div key={day.ymd} className={`hr-cal-dow${day.ymd === today ? ' today' : ''}`}>
            {day.dow}
            <br />
            <strong>{day.date.getDate()}</strong>
          </div>
        ))}
        <div className="hr-cal-week-corner" />
        {days.map((day) => {
          const evs = byDay.get(day.ymd) || [];
          return (
            <div
              key={`col-${day.ymd}`}
              className={`hr-cal-day${day.ymd === today ? ' today' : ''}${selectedYmd === day.ymd ? ' selected' : ''}`}
              onClick={() => onSelectDay?.(day.ymd)}
              role="button"
              tabIndex={0}
            >
              {evs.length ? evs.map(renderEvent) : <div className="hr-cal-empty-hint">Click to focus day</div>}
            </div>
          );
        })}
      </div>
    );
  } else if (view === 'day') {
    const ymd = fmtYmd(cursorDate);
    const evs = byDay.get(ymd) || [];
    body = (
      <div className="hr-cal-day-full">
        <div className="hr-cal-day-full-title">{title}</div>
        {!evs.length ? (
          <div className="hr-cal-day-empty">No tasks on this date.</div>
        ) : (
          evs.map((task) => (
            <button
              key={getTaskId(task)}
              type="button"
              className="hr-cal-day-card"
              style={{ borderLeftColor: getTaskColor(task) }}
              onClick={() => onTaskClick?.(task)}
            >
              <div className="hr-cal-day-card-title">{getTaskTitle(task)}</div>
            </button>
          ))
        )}
      </div>
    );
  } else {
    const y = cursorDate.getFullYear();
    body = (
      <div className="hr-cal-year">
        {MONTHS.map((label, mo) => (
          <div key={label} className="hr-cal-mini">
            <div className="hr-cal-mini-title">{label}</div>
            <div className="hr-cal-mini-grid">
              {DOW.map((w) => <span key={w} className="hr-cal-mini-dow">{w[0]}</span>)}
              {(() => {
                const first = new Date(y, mo, 1);
                const start = new Date(first);
                start.setDate(1 - first.getDay());
                const spans = [];
                for (let j = 0; j < 42; j += 1) {
                  const c = new Date(start);
                  c.setDate(start.getDate() + j);
                  if (c.getMonth() !== mo) {
                    spans.push(<span key={`e-${mo}-${j}`} className="hr-cal-mini-d empty" />);
                    continue;
                  }
                  const ymd = fmtYmd(c);
                  const has = (byDay.get(ymd) || []).length > 0;
                  spans.push(
                    <span
                      key={ymd}
                      className={`hr-cal-mini-d${has ? ' has' : ''}${ymd === today ? ' today' : ''}${selectedYmd === ymd ? ' selected' : ''}`}
                      onClick={() => {
                        onSelectDay?.(ymd);
                        onViewChange?.('day');
                        onCursorChange?.(c);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {c.getDate()}
                    </span>,
                  );
                }
                return spans;
              })()}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="hr-cal-wrap">
      <div className="hr-cal-top">
        <div>
          <div className="hr-cal-eyebrow">{eyebrow}</div>
          <div className="hr-cal-title">{title}</div>
        </div>
        <div className="hr-cal-nav">
          <button type="button" onClick={() => onCursorChange?.(shift(view, cursorDate, -1))} title="Previous">◀</button>
          <button type="button" className="hr-cal-today-btn" onClick={onToday}>Today</button>
          <button type="button" onClick={() => onCursorChange?.(shift(view, cursorDate, 1))} title="Next">▶</button>
        </div>
        <div className="hr-cal-views">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className={view === v ? 'on' : ''}
              onClick={() => onViewChange?.(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="hr-cal-body">{body}</div>
      {legend.length ? (
        <div className="hr-cal-legend">
          {legend.map((item) => (
            <span key={item.label} className="hr-cal-legend-item">
              <span className="hr-cal-legend-dot" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function shift(view, cursorDate, direction) {
  const d = new Date(cursorDate);
  if (view === 'day') d.setDate(d.getDate() + direction);
  else if (view === 'week') d.setDate(d.getDate() + direction * 7);
  else if (view === 'year') d.setFullYear(d.getFullYear() + direction);
  else d.setMonth(d.getMonth() + direction);
  return d;
}
