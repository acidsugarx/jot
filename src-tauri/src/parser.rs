use chrono::{
    DateTime, Datelike, Duration, Local, LocalResult, NaiveDate, NaiveTime, TimeZone, Weekday,
};

use crate::models::TaskPriority;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedTaskInput {
    pub title: String,
    pub priority: Option<TaskPriority>,
    pub tags: Vec<String>,
    pub due_date: Option<String>,
    pub zettel_requested: bool,
}

pub fn parse_task_input(raw_input: &str) -> ParsedTaskInput {
    let tokens: Vec<&str> = raw_input.split_whitespace().collect();
    let mut title_parts = Vec::new();
    let mut tags = Vec::new();
    let mut priority = None;
    let mut due_date = None;
    let mut zettel_requested = false;

    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index];

        if let Some(tag) = parse_tag_token(token) {
            tags.push(tag);
            index += 1;
            continue;
        }

        if let Some(value) = parse_priority_token(token) {
            priority = Some(value);
            index += 1;
            continue;
        }

        if token.eq_ignore_ascii_case("@zettel") {
            zettel_requested = true;
            index += 1;
            continue;
        }

        if let Some((parsed_due_date, consumed)) = parse_due_date_tokens(&tokens[index..]) {
            due_date = Some(parsed_due_date);
            index += consumed;
            continue;
        }

        title_parts.push(token);
        index += 1;
    }

    ParsedTaskInput {
        title: title_parts.join(" ").trim().to_string(),
        priority,
        tags,
        due_date,
        zettel_requested,
    }
}

fn parse_tag_token(token: &str) -> Option<String> {
    token
        .strip_prefix('#')
        .map(clean_token)
        .filter(|value| !value.is_empty())
}

fn parse_priority_token(token: &str) -> Option<TaskPriority> {
    let value = token.strip_prefix('!')?;

    match clean_token(value).as_str() {
        "low" => Some(TaskPriority::Low),
        "medium" => Some(TaskPriority::Medium),
        "high" => Some(TaskPriority::High),
        "urgent" => Some(TaskPriority::Urgent),
        _ => None,
    }
}

fn parse_due_date_tokens(tokens: &[&str]) -> Option<(String, usize)> {
    let first = *tokens.first()?;
    let today = Local::now().date_naive();

    // "today"
    if first.eq_ignore_ascii_case("today") {
        return Some((
            build_due_date(today, extract_time_token(tokens, 1))?,
            consumed_tokens(tokens, 1),
        ));
    }

    // "tomorrow"
    if first.eq_ignore_ascii_case("tomorrow") {
        return Some((
            build_due_date(today + Duration::days(1), extract_time_token(tokens, 1))?,
            consumed_tokens(tokens, 1),
        ));
    }

    // "next week" / "next monday" / etc.
    if first.eq_ignore_ascii_case("next") {
        if let Some(second) = tokens.get(1) {
            if second.eq_ignore_ascii_case("week") {
                return Some((
                    build_due_date(today + Duration::weeks(1), extract_time_token(tokens, 2))?,
                    consumed_tokens(tokens, 2),
                ));
            }
            if let Some(weekday) = parse_weekday(&clean_token(second)) {
                let target = next_weekday(today, weekday);
                return Some((
                    build_due_date(target, extract_time_token(tokens, 2))?,
                    consumed_tokens(tokens, 2),
                ));
            }
        }
    }

    // "in N days/weeks"
    if first.eq_ignore_ascii_case("in") {
        if let (Some(second), Some(third)) = (tokens.get(1), tokens.get(2)) {
            if let Ok(n) = second.parse::<i64>() {
                let unit = clean_token(third).to_lowercase();
                let target = match unit.as_str() {
                    "day" | "days" => Some(today + Duration::days(n)),
                    "week" | "weeks" => Some(today + Duration::weeks(n)),
                    _ => None,
                };
                if let Some(target) = target {
                    return Some((
                        build_due_date(target, extract_time_token(tokens, 3))?,
                        consumed_tokens(tokens, 3),
                    ));
                }
            }
        }
    }

    // Only try weekday/month names if token starts with a letter
    if first
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic())
    {
        // Weekday name: "monday", "fri", etc.
        if let Some(weekday) = parse_weekday(&clean_token(first)) {
            let target = next_weekday(today, weekday);
            return Some((
                build_due_date(target, extract_time_token(tokens, 1))?,
                consumed_tokens(tokens, 1),
            ));
        }

        // Month + day: "Mar 25", "December 3"
        if let Some(month_num) = parse_month_name(&clean_token(first)) {
            if let Some(second) = tokens.get(1) {
                if let Ok(day) = clean_token(second).parse::<u32>() {
                    if (1..=31).contains(&day) {
                        let year = if NaiveDate::from_ymd_opt(today.year(), month_num, day)
                            .map(|d| d >= today)
                            .unwrap_or(false)
                        {
                            today.year()
                        } else {
                            today.year() + 1
                        };

                        if let Some(date) = NaiveDate::from_ymd_opt(year, month_num, day) {
                            return Some((
                                build_due_date(date, extract_time_token(tokens, 2))?,
                                consumed_tokens(tokens, 2),
                            ));
                        }
                    }
                }
            }
        }
    }

    None
}

fn parse_weekday(s: &str) -> Option<Weekday> {
    match s.to_lowercase().as_str() {
        "monday" | "mon" => Some(Weekday::Mon),
        "tuesday" | "tue" | "tues" => Some(Weekday::Tue),
        "wednesday" | "wed" => Some(Weekday::Wed),
        "thursday" | "thu" | "thurs" => Some(Weekday::Thu),
        "friday" | "fri" => Some(Weekday::Fri),
        "saturday" | "sat" => Some(Weekday::Sat),
        "sunday" | "sun" => Some(Weekday::Sun),
        _ => None,
    }
}

fn next_weekday(from: NaiveDate, target: Weekday) -> NaiveDate {
    let current = from.weekday().num_days_from_monday();
    let target_num = target.num_days_from_monday();
    let days_ahead = if target_num <= current {
        7 - (current - target_num)
    } else {
        target_num - current
    };
    from + Duration::days(days_ahead as i64)
}

fn parse_month_name(s: &str) -> Option<u32> {
    match s.to_lowercase().as_str() {
        "jan" | "january" => Some(1),
        "feb" | "february" => Some(2),
        "mar" | "march" => Some(3),
        "apr" | "april" => Some(4),
        "may" => Some(5),
        "jun" | "june" => Some(6),
        "jul" | "july" => Some(7),
        "aug" | "august" => Some(8),
        "sep" | "september" => Some(9),
        "oct" | "october" => Some(10),
        "nov" | "november" => Some(11),
        "dec" | "december" => Some(12),
        _ => None,
    }
}

fn extract_time_token<'a>(tokens: &'a [&'a str], offset: usize) -> Option<&'a str> {
    if tokens
        .get(offset)
        .is_some_and(|token| token.eq_ignore_ascii_case("at"))
    {
        tokens.get(offset + 1).copied()
    } else {
        tokens.get(offset).copied()
    }
}

fn build_due_date(date: NaiveDate, maybe_time_token: Option<&str>) -> Option<String> {
    let parsed_time = maybe_time_token.and_then(parse_time_token);

    let date_time = match parsed_time {
        Some(time) => localize(date, time)?,
        None => localize(date, NaiveTime::from_hms_opt(9, 0, 0)?)?,
    };

    Some(date_time.to_rfc3339())
}

fn consumed_tokens(tokens: &[&str], day_tokens: usize) -> usize {
    if tokens
        .get(day_tokens)
        .and_then(|token| parse_time_token(token))
        .is_some()
    {
        day_tokens + 1
    } else if tokens
        .get(day_tokens)
        .is_some_and(|token| token.eq_ignore_ascii_case("at"))
        && tokens
            .get(day_tokens + 1)
            .and_then(|token| parse_time_token(token))
            .is_some()
    {
        day_tokens + 2
    } else {
        day_tokens
    }
}

fn parse_time_token(token: &str) -> Option<NaiveTime> {
    let normalized = clean_token(token).to_lowercase();

    if normalized.is_empty() || normalized == "at" {
        return None;
    }

    if let Ok(time) = NaiveTime::parse_from_str(&normalized, "%H:%M") {
        return Some(time);
    }

    if let Some(value) = normalized.strip_suffix("am") {
        return parse_meridiem_time(value, false);
    }

    if let Some(value) = normalized.strip_suffix("pm") {
        return parse_meridiem_time(value, true);
    }

    None
}

fn parse_meridiem_time(value: &str, is_pm: bool) -> Option<NaiveTime> {
    let (hour, minute) = if let Some((hour, minute)) = value.split_once(':') {
        (hour.parse::<u32>().ok()?, minute.parse::<u32>().ok()?)
    } else {
        (value.parse::<u32>().ok()?, 0)
    };

    if hour == 0 || hour > 12 || minute > 59 {
        return None;
    }

    let adjusted_hour = match (hour, is_pm) {
        (12, false) => 0,
        (12, true) => 12,
        (_, true) => hour + 12,
        (_, false) => hour,
    };

    NaiveTime::from_hms_opt(adjusted_hour, minute, 0)
}

fn localize(date: NaiveDate, time: NaiveTime) -> Option<DateTime<Local>> {
    match Local.from_local_datetime(&date.and_time(time)) {
        LocalResult::Single(value) => Some(value),
        LocalResult::Ambiguous(first, _) => Some(first),
        LocalResult::None => None,
    }
}

fn clean_token(value: &str) -> String {
    value
        .trim_matches(|character: char| {
            !character.is_alphanumeric() && character != '-' && character != '_'
        })
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_tags_priority_due_date_and_zettel_flag() {
        let parsed =
            parse_task_input("Write architecture review tomorrow at 10am #work !high @zettel");

        assert_eq!(parsed.title, "Write architecture review");
        assert_eq!(parsed.tags, vec!["work"]);
        assert_eq!(parsed.priority, Some(TaskPriority::High));
        assert!(parsed.due_date.is_some());
        assert!(parsed.zettel_requested);
    }

    #[test]
    fn leaves_plain_text_as_title() {
        let parsed = parse_task_input("Refactor parser state machine");

        assert_eq!(parsed.title, "Refactor parser state machine");
        assert!(parsed.tags.is_empty());
        assert_eq!(parsed.priority, None);
        assert_eq!(parsed.due_date, None);
        assert!(!parsed.zettel_requested);
    }

    #[test]
    fn parses_24_hour_times() {
        let parsed = parse_task_input("Plan sprint today 14:30 #planning");

        assert_eq!(parsed.title, "Plan sprint");
        assert_eq!(parsed.tags, vec!["planning"]);
        assert!(parsed.due_date.is_some());
    }

    #[test]
    fn parses_weekday_names() {
        let parsed = parse_task_input("Review PR friday #code");

        assert_eq!(parsed.title, "Review PR");
        assert_eq!(parsed.tags, vec!["code"]);
        assert!(parsed.due_date.is_some());
    }

    #[test]
    fn parses_next_weekday() {
        let parsed = parse_task_input("Team standup next monday");

        assert_eq!(parsed.title, "Team standup");
        assert!(parsed.due_date.is_some());
    }

    #[test]
    fn parses_next_week() {
        let parsed = parse_task_input("Plan roadmap next week");

        assert_eq!(parsed.title, "Plan roadmap");
        assert!(parsed.due_date.is_some());
    }

    #[test]
    fn parses_relative_days() {
        let parsed = parse_task_input("Ship feature in 3 days !high");

        assert_eq!(parsed.title, "Ship feature");
        assert_eq!(parsed.priority, Some(TaskPriority::High));
        assert!(parsed.due_date.is_some());
    }

    #[test]
    fn parses_relative_weeks() {
        let parsed = parse_task_input("Deploy v2 in 2 weeks");

        assert_eq!(parsed.title, "Deploy v2");
        assert!(parsed.due_date.is_some());
    }

    #[test]
    fn parses_month_day() {
        let parsed = parse_task_input("Conference talk Mar 25 #speaking");

        assert_eq!(parsed.title, "Conference talk");
        assert_eq!(parsed.tags, vec!["speaking"]);
        assert!(parsed.due_date.is_some());
    }

    #[test]
    fn next_weekday_always_returns_future_date() {
        let today = Local::now().date_naive();
        let target = next_weekday(today, today.weekday());

        assert_eq!((target - today).num_days(), 7);
    }
}
