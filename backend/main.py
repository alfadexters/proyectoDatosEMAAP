# main.py - Versión con Corrección en Análisis Comparativo

import pandas as pd
import requests
from flask import Flask, jsonify, request, render_template
from flask_cors import CORS

# --- CONFIGURACIÓN INICIAL ---
app = Flask(__name__)
CORS(app)

URL_GEO = "https://paramh2o.aguaquito.gob.ec/estacion/getjson"
URL_VAR = "https://paramh2o.aguaquito.gob.ec/ajax/estacion_consulta/?variable_id={}"
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyAIQtTjVjJj0fIC6kU5psOn5EtgGNDX9TM"

VARIABLES = {
    "precipitacion": {"id": 1, "filename": "precipitacionEstacionesDiario.csv"},
    "temperatura": {"id": 2, "filename": "temperaturaEstacionesDiario.csv"},
    "nivelAgua": {"id": 11, "filename": "nivelAguaEstacionesDiario.csv"}
}

# --- CARGA Y PROCESAMIENTO DE DATOS ---
print("Iniciando carga de datos en memoria...")

# 1. Cargar datos geográficos
try:
    geo_data = requests.get(URL_GEO).json()['features']
    estaciones_df = pd.DataFrame([{
        "codigo": f['properties']['codigo'],
        "nombre": f['properties']['nombre'],
        "latitud": f['geometry']['coordinates'][1],
        "longitud": f['geometry']['coordinates'][0],
        "altura": f['properties']['altura']
    } for f in geo_data])
    print(f"-> Se cargaron {len(estaciones_df)} estaciones con coordenadas.")
except Exception as e:
    print(f"Error cargando datos geográficos: {e}")
    estaciones_df = pd.DataFrame()

# 2. Cargar qué estaciones miden qué variable
estaciones_por_variable = {}
for nombre_var, var_info in VARIABLES.items():
    try:
        var_data = requests.get(URL_VAR.format(var_info['id'])).json()['estaciones']
        estaciones_por_variable[nombre_var] = [est['est_codigo'] for est in var_data]
    except Exception as e:
        print(f"Error cargando datos para la variable {nombre_var}: {e}")

# 3. Cargar los datos de mediciones y calcular calidad
datos_mediciones = {}
calidad_datos = {} 
anios_disponibles = {} 

for nombre_var, var_info in VARIABLES.items():
    try:
        ruta_csv = f"data/{var_info['filename']}"
        df = pd.read_csv(ruta_csv, delimiter=',')
        df = df.rename(columns={df.columns[0]: 'fecha_str'})
        df['fecha'] = pd.to_datetime(df['fecha_str'], format='%Y-%m-%d', errors='coerce')
        df.dropna(subset=['fecha'], inplace=True)
        df = df.drop(columns=['fecha_str'])
        
        puntaje_calidad = (df.count() / len(df)) * 100
        calidad_datos[nombre_var] = puntaje_calidad.round(2).to_dict()
        
        anios_disponibles[nombre_var] = sorted(df['fecha'].dt.year.unique().tolist())

        cols = ['fecha'] + [col for col in df.columns if col != 'fecha']
        df = df[cols]
        datos_mediciones[nombre_var] = df
        print(f"-> Cargado y analizado CSV para '{nombre_var}' con {len(df)} registros válidos.")
    except FileNotFoundError:
        print(f"Error: No se encontró el archivo {ruta_csv}.")
    except Exception as e:
        print(f"Error cargando el archivo CSV para {nombre_var}: {e}")

print("¡Carga de datos completa!")

# --- RUTAS DE LA API ---

@app.route('/api/estaciones')
def get_estaciones():
    if estaciones_df.empty:
        return jsonify({"error": "No se pudieron cargar los datos de las estaciones"}), 500
    
    estaciones_con_vars = estaciones_df.copy()
    for nombre_var, codigos in estaciones_por_variable.items():
        estaciones_con_vars[nombre_var] = estaciones_con_vars['codigo'].isin(codigos)
    
    estaciones_final = estaciones_con_vars.astype(object).where(pd.notnull(estaciones_con_vars), None)
    return jsonify(estaciones_final.to_dict('records'))

@app.route('/api/datos')
def get_datos():
    variable = request.args.get('variable')
    estaciones_cod_str = request.args.get('estaciones')
    fecha_inicio = request.args.get('fecha_inicio')
    fecha_fin = request.args.get('fecha_fin')
    suavizar = request.args.get('suavizar') == 'true'
    
    if not variable or not estaciones_cod_str or variable not in datos_mediciones:
        return jsonify({"error": "Parámetros inválidos"}), 400
        
    estaciones_cod = estaciones_cod_str.split(',')
    df = datos_mediciones[variable]

    if fecha_inicio and fecha_fin:
        df = df[(df['fecha'] >= fecha_inicio) & (df['fecha'] <= fecha_fin)]

    columnas_a_seleccionar = ['fecha'] + [cod for cod in estaciones_cod if cod in df.columns]
    
    if len(columnas_a_seleccionar) <= 1: return jsonify([])

    datos_filtrados = df[columnas_a_seleccionar].copy()

    if suavizar:
        for cod in estaciones_cod:
            if cod in datos_filtrados.columns:
                datos_filtrados[f"{cod}_suavizado"] = datos_filtrados[cod].rolling(window=7, center=True, min_periods=1).mean()

    datos_filtrados['fecha'] = datos_filtrados['fecha'].dt.strftime('%Y-%m-%d')
    datos_filtrados_final = datos_filtrados.astype(object).where(pd.notnull(datos_filtrados), None)
    return jsonify(datos_filtrados_final.to_dict('records'))

@app.route('/api/calidad-datos')
def get_calidad_datos():
    resultado = []
    for index, estacion in estaciones_df.iterrows():
        info_estacion = {"codigo": estacion["codigo"], "nombre": estacion["nombre"]}
        for nombre_var, puntajes in calidad_datos.items():
            info_estacion[f"calidad_{nombre_var}"] = puntajes.get(estacion["codigo"], 0)
        resultado.append(info_estacion)
    return jsonify(resultado)

@app.route('/api/reconstruir-datos')
def reconstruir_datos():
    variable = request.args.get('variable')
    estacion_cod = request.args.get('estacion')
    metodo = request.args.get('metodo')
    fecha_inicio = request.args.get('fecha_inicio')
    fecha_fin = request.args.get('fecha_fin')

    if not all([variable, estacion_cod, metodo]) or variable not in datos_mediciones:
        return jsonify({"error": "Parámetros inválidos"}), 400

    df_original = datos_mediciones[variable][['fecha', estacion_cod]].copy()
    
    if fecha_inicio and fecha_fin:
        df_original = df_original[(df_original['fecha'] >= fecha_inicio) & (df_original['fecha'] <= fecha_fin)]

    total_rows = len(df_original)
    non_null_original = df_original[estacion_cod].count()
    calidad_antes = round((non_null_original / total_rows) * 100, 2) if total_rows > 0 else 0

    if calidad_antes < 65:
        return jsonify({"error": "Calidad de datos insuficiente", "quality_before": calidad_antes}), 400

    if metodo == 'lineal':
        df_original['reconstruido'] = df_original[estacion_cod].interpolate(method='linear')
    elif metodo == 'promedio_movil':
        rolling_mean = df_original[estacion_cod].rolling(window=7, center=True, min_periods=1).mean()
        df_original['reconstruido'] = df_original[estacion_cod].fillna(rolling_mean)
    else:
        return jsonify({"error": "Método no soportado"}), 400

    non_null_reconstruido = df_original['reconstruido'].count()
    calidad_despues = round((non_null_reconstruido / total_rows) * 100, 2) if total_rows > 0 else 0

    df_original['fecha'] = df_original['fecha'].dt.strftime('%Y-%m-%d')
    df_final = df_original.astype(object).where(pd.notnull(df_original), None)
    df_final.rename(columns={estacion_cod: 'original'}, inplace=True)

    response_data = {
        "data": df_final.to_dict('records'),
        "quality_before": calidad_antes,
        "quality_after": calidad_despues
    }
    return jsonify(response_data)

@app.route('/api/generar-narrativa')
def generar_narrativa():
    tema = request.args.get('tema')
    if not tema:
        return jsonify({"error": "Tema no especificado"}), 400

    prompt = ""
    if tema == 'dia_mas_frio':
        df_temp = datos_mediciones['temperatura'].drop(columns=['fecha'])
        min_temp = df_temp.min().min()
        pos = df_temp.stack().idxmin()
        fecha = datos_mediciones['temperatura'].loc[pos[0], 'fecha'].strftime('%d de %B de %Y')
        codigo_estacion = pos[1]
        nombre_estacion = estaciones_df.loc[estaciones_df['codigo'] == codigo_estacion, 'nombre'].iloc[0]
        
        prompt = f"Actúa como un meteorólogo y divulgador científico para una página web sobre el clima de Quito, Ecuador. Escribe una narrativa corta y atractiva (máximo 3 párrafos) sobre el siguiente dato que hemos encontrado en nuestros registros históricos. Dato: El día más frío del último año fue el {fecha}, registrado en la estación '{nombre_estacion} ({codigo_estacion})', con una temperatura mínima de {min_temp:.2f}°C. En tu narrativa, explica qué podría significar esta temperatura para la zona, si es un evento común, y qué se podría sentir a esa temperatura en esa ubicación específica. Usa un lenguaje sencillo y cautivador."

    elif tema == 'dia_mas_caluroso':
        df_temp = datos_mediciones['temperatura'].drop(columns=['fecha'])
        max_temp = df_temp.max().max()
        pos = df_temp.stack().idxmax()
        fecha = datos_mediciones['temperatura'].loc[pos[0], 'fecha'].strftime('%d de %B de %Y')
        codigo_estacion = pos[1]
        nombre_estacion = estaciones_df.loc[estaciones_df['codigo'] == codigo_estacion, 'nombre'].iloc[0]
        
        prompt = f"Actúa como un meteorólogo y divulgador científico para una página web sobre el clima de Quito, Ecuador. Escribe una narrativa corta y atractiva (máximo 3 párrafos) sobre el siguiente dato que hemos encontrado en nuestros registros históricos. Dato: El día más caluroso del último año fue el {fecha}, registrado en la estación '{nombre_estacion} ({codigo_estacion})', con una temperatura máxima de {max_temp:.2f}°C. En tu narrativa, explica qué podría significar esta temperatura para la zona, si es un evento común, y qué se podría sentir a esa temperatura en esa ubicación específica. Usa un lenguaje sencillo y cautivador."

    elif tema == 'dia_mas_lluvioso':
        df_precip = datos_mediciones['precipitacion'].drop(columns=['fecha'])
        max_precip = df_precip.max().max()
        pos = df_precip.stack().idxmax()
        fecha = datos_mediciones['precipitacion'].loc[pos[0], 'fecha'].strftime('%d de %B de %Y')
        codigo_estacion = pos[1]
        nombre_estacion = estaciones_df.loc[estaciones_df['codigo'] == codigo_estacion, 'nombre'].iloc[0]
        
        prompt = f"Actúa como un meteorólogo y divulgador científico para una página web sobre el clima de Quito, Ecuador. Escribe una narrativa corta y atractiva (máximo 3 párrafos) sobre el siguiente dato que hemos encontrado en nuestros registros históricos. Dato: El día con la mayor precipitación registrada del último año fue el {fecha}, en la estación '{nombre_estacion} ({codigo_estacion})', con un total de {max_precip:.2f} mm de lluvia. En tu narrativa, explica la magnitud de esta lluvia (comparándola con un promedio si es posible), qué impacto pudo tener en la zona (posibles inundaciones, crecidas de ríos), y su importancia para los embalses de la ciudad. Usa un lenguaje sencillo y cautivador."
    
    else:
        return jsonify({"error": "Tema no soportado"}), 400

    try:
        payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}]}
        headers = {'Content-Type': 'application/json'}
        response = requests.post(GEMINI_API_URL, json=payload, headers=headers)
        response.raise_for_status()
        
        gemini_response = response.json()
        narrativa = gemini_response['candidates'][0]['content']['parts'][0]['text']
        return jsonify({"narrativa": narrativa})

    except Exception as e:
        print(f"Error llamando a la API de Gemini: {e}")
        return jsonify({"error": "No se pudo generar la narrativa desde la IA."}), 500

# --- ENDPOINT CORREGIDO: Para el Análisis Comparativo ---
@app.route('/api/comparativo-anual')
def get_comparativo_anual():
    variable = request.args.get('variable')
    estacion_cod = request.args.get('estacion')
    mes_str = request.args.get('mes')
    anios_str = request.args.get('anios')

    # Caso 1: El frontend solo pide la lista de años para una variable
    if variable and not all([estacion_cod, mes_str, anios_str]):
        return jsonify({
            "anios_disponibles": anios_disponibles.get(variable, [])
        })

    # Caso 2: El frontend pide los datos para la comparación
    if not all([variable, estacion_cod, mes_str, anios_str]):
        return jsonify({"error": "Parámetros inválidos"}), 400
    
    try:
        mes = int(mes_str)
        anios = [int(a) for a in anios_str.split(',')]
    except (ValueError, TypeError):
        return jsonify({"error": "Parámetros de mes o años inválidos"}), 400

    df = datos_mediciones[variable]
    df_filtrado = df[df['fecha'].dt.month == mes]
    df_filtrado = df_filtrado[df_filtrado['fecha'].dt.year.isin(anios)]

    if estacion_cod not in df_filtrado.columns:
        return jsonify({"data": []})

    if variable == 'precipitacion':
        resultado = df_filtrado.groupby(df_filtrado['fecha'].dt.year)[estacion_cod].sum()
    else:
        resultado = df_filtrado.groupby(df_filtrado['fecha'].dt.year)[estacion_cod].mean()
    
    datos_formateados = [{'anio': anio, 'valor': round(valor, 2)} for anio, valor in resultado.items()]
    
    return jsonify({"data": datos_formateados})


# --- RUTA PARA SERVIR LA PÁGINA WEB ---
@app.route('/')
def index():
    return render_template('index.html')

# --- INICIAR EL SERVIDOR ---
if __name__ == '__main__':
    app.run(debug=True, port=5000)
