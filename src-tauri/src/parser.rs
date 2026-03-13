use chrono::{DateTime, Duration, Local, LocalResult, NaiveDate, NaiveTime, TimeZone};

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

    if first.eq_ignore_ascii_case("today") {
        return Some((
            build_due_date(today, extract_time_token(tokens, 1))?,
            consumed_tokens(tokens, 1),
        ));
    }

    if first.eq_ignore_ascii_case("tomorrow") {
        return Some((
            build_due_date(today + Duration::days(1), extract_time_token(tokens, 1))?,
            consumed_tokens(tokens, 1),
        ));
    }

    None
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
}
