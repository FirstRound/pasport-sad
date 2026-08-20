import sqlite3
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from typing import Dict, Any
import os
import glob

app = FastAPI(title="Agro Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_FILE = "agro_platform.db"
EXCEL_FILE = "База для Паспорта сорта_v4.xlsx"

# Умный поиск файла матрицы рисков (игнорируем проблемы с unicode-символами "й")
decision_files = glob.glob("*матрица_принятия_решени*.xlsx")
DECISION_FILE = decision_files[0] if decision_files else "20260601_Паспорта_сортов_матрица_принятия_решений_v21_JP (2).xlsx"

def clean_nan(val):
    if pd.isna(val): return ""
    return str(val).strip()

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # 1. Таблица пользователей
    cursor.execute('''CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT UNIQUE,
                        password TEXT,
                        role TEXT)''')
    
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO users (username, password, role) VALUES ('admin', 'admin', 'admin')")
        cursor.execute("INSERT INTO users (username, password, role) VALUES ('user', 'user', 'user')")
        conn.commit()

    # 2. Таблица сортов (Паспорта)
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='varieties'")
    if not cursor.fetchone():
        try:
            df_sort = pd.read_excel(EXCEL_FILE, sheet_name='Характеристики сорта', header=3)
            df_sort = df_sort.loc[:, ~df_sort.columns.str.contains('^Unnamed')]
            df_sort = df_sort.dropna(subset=['Сорт'])

            df_podvoy = pd.read_excel(EXCEL_FILE, sheet_name='Характеристики сорто-подвоя', header=2)
            df_podvoy = df_podvoy.loc[:, ~df_podvoy.columns.str.contains('^Unnamed')]
            df_podvoy = df_podvoy.dropna(subset=['Сорт', 'Подвой'])

            df_merged = pd.merge(df_sort, df_podvoy, on='Сорт', how='left')
            df_merged['Подвой'] = df_merged['Подвой'].fillna('—')
            
            df_merged['Название сорто-подвоя'] = df_merged.apply(
                lambda row: f"{row['Сорт']} - {row['Подвой']}" if row['Подвой'] != '—' else row['Сорт'], 
                axis=1
            )
            
            df_merged = df_merged.fillna('')
            df_merged.to_sql('varieties', conn, if_exists='replace', index=True, index_label='id')
        except Exception as e:
            print(f"Ошибка при инициализации БД сортов: {e}")

    # 3. Таблица Регламентов и Коэффициентов
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='protocols'")
    if not cursor.fetchone():
        print("Синхронизация матрицы рисков и коэффициентов...")
        try:
            # Парсинг Листа "Дерево решений" (Заголовки на 3-й строке)
            df_dec = pd.read_excel(DECISION_FILE, sheet_name='2. Дерево решений', header=2)
            protocols_list = []
            
            for i in range(1, len(df_dec)):
                row = df_dec.iloc[i]
                if pd.isna(row.iloc[6]) or pd.isna(row.iloc[12]): 
                    continue
                protocols_list.append({
                    'phase': clean_nan(row.iloc[6]),
                    'risk_type': clean_nan(row.iloc[4]),
                    'risk_name': clean_nan(row.iloc[5]),
                    'trigger': f"{clean_nan(row.iloc[8])} ... {clean_nan(row.iloc[10])} {clean_nan(row.iloc[11])}",
                    'action': clean_nan(row.iloc[12]),
                    'volume': f"{clean_nan(row.iloc[13])} - {clean_nan(row.iloc[14])} {clean_nan(row.iloc[15])}",
                    'duration': f"{clean_nan(row.iloc[16])} - {clean_nan(row.iloc[17])} {clean_nan(row.iloc[18])}",
                    'expected': f"{clean_nan(row.iloc[19])} - {clean_nan(row.iloc[20])} {clean_nan(row.iloc[21])}"
                })
            
            if protocols_list:
                pd.DataFrame(protocols_list).to_sql('protocols', conn, if_exists='replace', index=False)
            
            # Парсинг Листа "Коэффициенты" (Заголовки на 5-й строке)
            df_coef = pd.read_excel(DECISION_FILE, sheet_name='1.1 Коэффициенты корректировки', header=4)
            coef_list = []
            for i in range(len(df_coef)):
                operation = clean_nan(df_coef.iloc[i, 1])
                if not operation: continue
                
                for col_idx in range(2, 27):
                    combo_name = str(df_coef.columns[col_idx]).strip()
                    if "Unnamed" in combo_name: continue
                    val = df_coef.iloc[i, col_idx]
                    
                    coef_list.append({
                        'operation': operation,
                        'combo_name': combo_name,
                        'coefficient': float(val) if pd.notna(val) else 0.0
                    })
                    
            if coef_list:
                pd.DataFrame(coef_list).to_sql('coefficients', conn, if_exists='replace', index=False)
                
            print("Матрица решений успешно загружена.")
        except Exception as e:
            print(f"Ошибка при загрузке матрицы решений: {e}")
            
    conn.close()

@app.on_event("startup")
def startup_event():
    init_db()

# --- ЭНДПОИНТЫ API ---

@app.post("/api/login")
def login(creds: Dict[str, str]):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT username, role FROM users WHERE username=? AND password=?", (creds.get('username'), creds.get('password')))
    user = cursor.fetchone()
    conn.close()
    if user: return {"username": user[0], "role": user[1]}
    raise HTTPException(status_code=401, detail="Неверные учетные данные")

@app.get("/api/varieties")
def get_varieties():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM varieties ORDER BY id DESC")
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

@app.post("/api/varieties")
def create_variety(payload: Dict[str, Any]):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    payload.pop('id', None)
    payload.pop('rootstocks', None) 
    columns = ", ".join([f'"{k}"' for k in payload.keys()])
    placeholders = ", ".join(["?"] * len(payload))
    try:
        cursor.execute(f"INSERT INTO varieties ({columns}) VALUES ({placeholders})", list(payload.values()))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
    conn.close()
    return {"status": "success"}

@app.put("/api/varieties/{item_id}")
def update_variety(item_id: int, payload: Dict[str, Any]):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    payload.pop('id', None)
    payload.pop('rootstocks', None) 
    set_clause = ", ".join([f'"{k}" = ?' for k in payload.keys()])
    values = list(payload.values()) + [item_id]
    try:
        cursor.execute(f'UPDATE varieties SET {set_clause} WHERE id = ?', values)
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
    conn.close()
    return {"status": "success"}

@app.delete("/api/varieties/{item_id}")
def delete_variety(item_id: int):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM varieties WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.get("/api/protocols")
def get_global_protocols():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM protocols")
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

@app.get("/api/varieties/{item_id}/plan")
def get_variety_plan(item_id: int):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM varieties WHERE id=?", (item_id,))
    variety = cursor.fetchone()
    if not variety:
        conn.close()
        raise HTTPException(status_code=404, detail="Сорт не найден")
        
    combo_name = variety["Название сорто-подвоя"]
    
    cursor.execute("SELECT operation, coefficient FROM coefficients WHERE combo_name=?", (combo_name,))
    coeffs = {row['operation']: row['coefficient'] for row in cursor.fetchall() if row['coefficient'] > 0}
    
    cursor.execute("SELECT * FROM protocols")
    all_protocols = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    nodes_dict = {}
    for p in all_protocols:
        action = p['action']
        if coeffs and action not in coeffs:
            continue
            
        coeff = coeffs.get(action, 1.0)
        phase = p['phase']
        
        if phase not in nodes_dict:
            nodes_dict[phase] = {"phase": phase, "risks": []}
        
        risk = next((r for r in nodes_dict[phase]["risks"] if r["name"] == p['risk_name']), None)
        if not risk:
            risk = {
                "type": p['risk_type'],
                "name": p['risk_name'],
                "condition": p['trigger'],
                "desc": "Событие по фенофазе",
                "operations": []
            }
            nodes_dict[phase]["risks"].append(risk)
            
        risk["operations"].append({
            "name": action,
            "type": "Агротехническая",
            "volume": p['volume'],
            "duration": p['duration'],
            "instruction": f"Ожидаемый результат: {p['expected']}. Коэффициент: x{coeff}"
        })
        
    return list(nodes_dict.values())

@app.get("/")
def serve_frontend():
    if os.path.exists("index.html"):
        return FileResponse("index.html")
    return {"error": "Файл index.html не найден"}

@app.get("/app.js")
def serve_js():
    if os.path.exists("app.js"):
        return FileResponse("app.js")
    return {"error": "Файл app.js не найден"}
