//! A thread that shows each reminder as a notification when it comes due, for as long as the
//! app runs, even with its window hidden.

use std::collections::HashSet;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use super::Reminder;

/// Reminders that came due longer ago than this are dropped instead of shown late.
const GRACE_MS: u64 = 60 * 60 * 1000;
/// Longest sleep, so the wall clock is checked again after the computer was suspended.
const MAX_WAIT: Duration = Duration::from_secs(30);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

#[derive(Default)]
struct Schedule {
    reminders: Vec<Reminder>,
    fired: HashSet<(String, u64)>,
}

impl Schedule {
    fn replace(&mut self, reminders: Vec<Reminder>) {
        let keys: HashSet<_> = reminders.iter().map(key).collect();
        self.fired.retain(|fired| keys.contains(fired));
        self.reminders = reminders;
    }

    /// The reminders that are due and not shown yet.
    fn take_due(&mut self, now: u64) -> Vec<Reminder> {
        let due: Vec<_> = self
            .reminders
            .iter()
            .filter(|r| r.at <= now && now - r.at <= GRACE_MS && !self.fired.contains(&key(r)))
            .cloned()
            .collect();
        self.fired.extend(due.iter().map(key));
        due
    }

    fn next_at(&self, now: u64) -> Option<u64> {
        self.reminders
            .iter()
            .map(|r| r.at)
            .filter(|&at| at > now)
            .min()
    }
}

fn key(reminder: &Reminder) -> (String, u64) {
    (reminder.id.clone(), reminder.at)
}

#[derive(Default)]
pub struct Scheduler {
    schedule: Mutex<Schedule>,
    changed: Condvar,
}

impl Scheduler {
    fn lock(&self) -> MutexGuard<'_, Schedule> {
        self.schedule
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn set(&self, reminders: Vec<Reminder>) {
        self.lock().replace(reminders);
        self.changed.notify_all();
    }

    /// Calls `show` for each reminder when it comes due. Never returns.
    fn run(&self, show: impl Fn(&Reminder)) {
        let mut schedule = self.lock();
        loop {
            let now = now_ms();
            let due = schedule.take_due(now);
            let wait = schedule
                .next_at(now)
                .map_or(MAX_WAIT, |at| Duration::from_millis(at - now).min(MAX_WAIT));
            drop(schedule);
            due.iter().for_each(&show);
            schedule = self.lock();
            if due.is_empty() {
                schedule = self
                    .changed
                    .wait_timeout(schedule, wait)
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .0;
            }
        }
    }
}

fn show(app: &AppHandle, reminder: &Reminder) {
    let shown = app
        .notification()
        .builder()
        .title(reminder.text.clone())
        .body("Ergon")
        .show();
    if let Err(error) = shown {
        eprintln!("could not show reminder: {error}");
    }
}

/// Starts the thread that shows reminders as they come due.
pub fn setup(app: &tauri::App) {
    let scheduler = Arc::new(Scheduler::default());
    app.manage(scheduler.clone());
    let app = app.handle().clone();
    std::thread::spawn(move || scheduler.run(|reminder| show(&app, reminder)));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reminder(id: &str, at: u64) -> Reminder {
        Reminder {
            id: id.into(),
            at,
            text: id.into(),
        }
    }

    fn schedule(reminders: Vec<Reminder>) -> Schedule {
        let mut schedule = Schedule::default();
        schedule.replace(reminders);
        schedule
    }

    #[test]
    fn shows_due_reminders_once() {
        let mut schedule = schedule(vec![reminder("a", 1_000), reminder("b", 5_000)]);
        assert_eq!(schedule.take_due(2_000), vec![reminder("a", 1_000)]);
        assert_eq!(schedule.take_due(3_000), vec![]);
        assert_eq!(schedule.take_due(5_000), vec![reminder("b", 5_000)]);
    }

    #[test]
    fn drops_reminders_missed_by_more_than_the_grace() {
        let mut schedule = schedule(vec![reminder("old", 1_000)]);
        assert_eq!(schedule.take_due(1_000 + GRACE_MS + 1), vec![]);
        let mut schedule = self::schedule(vec![reminder("recent", 1_000)]);
        assert_eq!(schedule.take_due(1_000 + GRACE_MS).len(), 1);
    }

    #[test]
    fn remembers_shown_reminders_across_updates() {
        let mut schedule = schedule(vec![reminder("a", 1_000)]);
        assert_eq!(schedule.take_due(1_000).len(), 1);
        schedule.replace(vec![reminder("a", 1_000), reminder("b", 9_000)]);
        assert_eq!(schedule.take_due(2_000), vec![]);
    }

    #[test]
    fn shows_a_moved_reminder_again() {
        let mut schedule = schedule(vec![reminder("a", 1_000)]);
        assert_eq!(schedule.take_due(1_000).len(), 1);
        schedule.replace(vec![reminder("a", 3_000)]);
        assert_eq!(schedule.take_due(3_000).len(), 1);
    }

    #[test]
    fn finds_the_next_reminder() {
        let schedule = schedule(vec![
            reminder("a", 1_000),
            reminder("b", 9_000),
            reminder("c", 5_000),
        ]);
        assert_eq!(schedule.next_at(1_000), Some(5_000));
        assert_eq!(schedule.next_at(9_000), None);
    }
}
