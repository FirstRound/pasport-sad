import os
import urllib.parse
from typing import Dict, Any

import pandas as pd
import psycopg2
from psycopg2.extras import RealDictCursor
from sqlalchemy import create_engine, inspect
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI(title="Agro Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Настройки подключения к PostgreSQL
DB_HOST = "176.124.217.84"
DB_PORT = "5432"
DB_NAME = "default_db"
DB_USER = "gen_user"
DB_PASS = "ik^_Di:9);Wn>e"

# Безопасное кодирование пароля для SQLAlchemy (защита от спецсимволов)
encoded_pass = urllib.parse.quote_plus(DB_PASS)
DB_URL = f"postgresql+psycopg2://{DB_USER}:{encoded_pass}@{DB_HOST}:{DB_PORT}/{DB_NAME}?sslmode=prefer"

EXCEL_FILE = "База для Паспорта сорта_v4.xlsx"
DECISION_FILE = "20260601_Паспорта_сортов_матрица_принятия_решений_v21_JP (2).xlsx"

def clean_nan(val):
    if pd.isna(val): return ""
    return str(val).strip()

def get_db_connection():
    """Создает и возвращает подключение к PostgreSQL"""
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASS,
        sslmode="prefer",
        cursor_factory=RealDictCursor
    )

def init_db():
    # SQLAlchemy Engine для загрузки Excel-данных через pandas
    engine = create_engine(DB_URL)
    inspector = inspect(engine)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Таблица пользователей (PostgreSQL использует SERIAL)
    cursor.execute('''CREATE TABLE IF NOT EXISTS users (
                        id SERIAL PRIMARY KEY,
                        username VARCHAR(50) UNIQUE,
                        password VARCHAR(255),
                        role VARCHAR(50))''')
    
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()['count'] == 0:
        cursor.execute("INSERT INTO users (username, password, role) VALUES ('admin', 'admin', 'admin')")
        cursor.execute("INSERT INTO users (username, password, role) VALUES ('user', 'user', 'user')")
    
    conn.commit()
    conn.close()

    # 2. Таблица сортов (Паспорта)
    if 'varieties' not in inspector.get_table_names():
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
            df_merged.to_sql('varieties', engine, if_exists='replace', index=True, index_label='id')
            print("БД сортов успешно инициализирована.")
        except Exception as e:
            print(f"Ошибка при инициализации БД сортов: {e}")

    # 3. Таблица Регламентов и Коэффициентов
    if 'protocols' not in inspector.get_table_names():
        print("Синхронизация матрицы рисков и коэффициентов...")
        try:
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
                pd.DataFrame(protocols_list).to_sql('protocols', engine, if_exists='replace', index=False)
            
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
                pd.DataFrame(coef_list).to_sql('coefficients', engine, if_exists='replace', index=False)
                
            print("Матрица решений успешно загружена.")
        except Exception as e:
            print(f"Ошибка при загрузке матрицы решений: {e}")
            
@app.on_event("startup")
def startup_event():
    init_db()

# --- ЭНДПОИНТЫ API ---

@app.post("/api/login")
def login(creds: Dict[str, str]):
    conn = get_db_connection()
    cursor = conn.cursor()
    # PostgreSQL использует %s вместо ?
    cursor.execute("SELECT username, role FROM users WHERE username=%s AND password=%s", 
                   (creds.get('username'), creds.get('password')))
    user = cursor.fetchone()
    conn.close()
    if user: return {"username": user['username'], "role": user['role']}
    raise HTTPException(status_code=401, detail="Неверные учетные данные")

@app.get("/api/varieties")
def get_varieties():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM "varieties" ORDER BY "id" DESC')
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.post("/api/varieties")
def create_variety(payload: Dict[str, Any]):
    conn = get_db_connection()
    cursor = conn.cursor()
    payload.pop('id', None)
    payload.pop('rootstocks', None) 
    columns = ", ".join([f'"{k}"' for k in payload.keys()])
    placeholders = ", ".join(["%s"] * len(payload))
    try:
        cursor.execute(f'INSERT INTO "varieties" ({columns}) VALUES ({placeholders})', list(payload.values()))
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
    conn.close()
    return {"status": "success"}

@app.put("/api/varieties/{item_id}")
def update_variety(item_id: int, payload: Dict[str, Any]):
    conn = get_db_connection()
    cursor = conn.cursor()
    payload.pop('id', None)
    payload.pop('rootstocks', None) 
    set_clause = ", ".join([f'"{k}" = %s' for k in payload.keys()])
    values = list(payload.values()) + [item_id]
    try:
        cursor.execute(f'UPDATE "varieties" SET {set_clause} WHERE "id" = %s', values)
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
    conn.close()
    return {"status": "success"}

@app.delete("/api/varieties/{item_id}")
def delete_variety(item_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM "varieties" WHERE "id" = %s', (item_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.get("/api/protocols")
def get_global_protocols():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM "protocols"')
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.get("/api/varieties/{item_id}/plan")
def get_variety_plan(item_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM "varieties" WHERE "id"=%s', (item_id,))
    variety = cursor.fetchone()
    if not variety:
        conn.close()
        raise HTTPException(status_code=404, detail="Сорт не найден")
        
    combo_name = variety["Название сорто-подвоя"]
    
    cursor.execute('SELECT operation, coefficient FROM "coefficients" WHERE combo_name=%s', (combo_name,))
    coeffs = {row['operation']: row['coefficient'] for row in cursor.fetchall() if row['coefficient'] > 0}
    
    cursor.execute('SELECT * FROM "protocols"')
    all_protocols = cursor.fetchall()
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
