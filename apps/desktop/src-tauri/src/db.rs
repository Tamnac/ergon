use std::path::Path;
use std::sync::Mutex;

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Number, Value as Json};
use tauri::State;

/// The app database; one connection, serialized by the mutex.
pub struct Db(Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
        Ok(Self(Mutex::new(conn)))
    }
}

#[tauri::command]
pub async fn sql_exec(db: State<'_, Db>, sql: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(&sql).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sql_query(
    db: State<'_, Db>,
    sql: String,
    params: Vec<Json>,
) -> Result<Vec<Map<String, Json>>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    query(&conn, &sql, &params).map_err(|e| e.to_string())
}

fn query(
    conn: &Connection,
    sql: &str,
    params: &[Json],
) -> rusqlite::Result<Vec<Map<String, Json>>> {
    let mut stmt = conn.prepare(sql)?;
    let columns: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    let values = params.iter().map(to_sql);
    let mut rows = stmt.query(params_from_iter(values))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut map = Map::new();
        for (i, name) in columns.iter().enumerate() {
            map.insert(name.clone(), from_sql(row.get_ref(i)?));
        }
        out.push(map);
    }
    Ok(out)
}

fn to_sql(value: &Json) -> Value {
    match value {
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().unwrap_or_default()),
        },
        Json::String(s) => Value::Text(s.clone()),
        Json::Bool(b) => Value::Integer(*b as i64),
        _ => Value::Null,
    }
}

fn from_sql(value: ValueRef) -> Json {
    match value {
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => Number::from_f64(f).map_or(Json::Null, Json::Number),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Null | ValueRef::Blob(_) => Json::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_values() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (a TEXT, b INTEGER, c REAL, d TEXT)")
            .unwrap();
        let params = [Json::from("x"), Json::from(3), Json::from(1.5), Json::Null];
        query(&conn, "INSERT INTO t VALUES (?, ?, ?, ?)", &params).unwrap();
        let rows = query(&conn, "SELECT * FROM t WHERE b = ?", &[Json::from(3)]).unwrap();
        assert_eq!(
            Json::Object(rows[0].clone()),
            serde_json::json!({ "a": "x", "b": 3, "c": 1.5, "d": null })
        );
    }
}
