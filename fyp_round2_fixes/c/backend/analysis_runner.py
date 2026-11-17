import os
import sys
import json
import re
import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy.stats import zscore
from scipy import stats
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
import io
import base64

STUDENT_COL_ALIASES = {
    "student reg no",
    "student",
    "studentemail",
    "student email",
}

# Columns skipped when auto-detecting variables from uploaded spreadsheets
METADATA_COL_HINTS = re.compile(
    r"(email|e-mail|password|phone|address|submitted|survey|orgemail|org email|"
    r"studentemail|student email|studentname|student name|fullname|full name|"
    r"timestamp|datetime|createdat|updatedat|comments?|remarks?|^id$|^_id$)",
    re.IGNORECASE,
)


def _is_metadata_column(col_name):
    c = str(col_name).strip().lower()
    if c in STUDENT_COL_ALIASES:
        return True
    if METADATA_COL_HINTS.search(str(col_name).strip()):
        return True
    return False


# ----------------------------
# IO helpers
# ----------------------------
def read_payload():
    raw = sys.stdin.read()
    return json.loads(raw) if raw else {}

def excel_path():
    """
    Always resolve Excel path relative to backend folder (where this file lives).
    This prevents the 'backend/routes/exports/...' bug.
    """
    backend_dir = os.path.dirname(os.path.abspath(__file__))  # .../backend
    rel = os.environ.get("ANALYSIS_EXCEL_PATH", "exports/master_feedback.xlsx")
    return os.path.abspath(os.path.join(backend_dir, rel))

MAX_ANALYSIS_ROWS = int(os.environ.get("MAX_ANALYSIS_ROWS", "100000"))
LARGE_FILE_BYTES = int(os.environ.get("LARGE_FILE_BYTES", str(8 * 1024 * 1024)))
DETECT_VARIABLES_ROWS = int(os.environ.get("DETECT_VARIABLES_ROWS", "5000"))


def _clean_dataframe(df):
    df.columns = (
        df.columns.astype(str)
        .str.strip()
        .str.replace("'", "", regex=False)
        .str.replace('"', "", regex=False)
    )
    unnamed = df.columns.str.match(r"^Unnamed", case=False, na=False)
    if unnamed.any():
        df = df.loc[:, ~unnamed]
    df = df.dropna(axis=1, how="all")
    df = df.dropna(axis=0, how="all")
    return df


def load_df(custom_excel_path=None, nrows=None, cap_rows=True):
    """Load DataFrame from Excel or CSV; cap rows for very large files."""
    if custom_excel_path:
        p = custom_excel_path
    else:
        p = excel_path()

    print(f"📁 Loading data file from: {p}", file=sys.stderr)

    file_size = os.path.getsize(p) if os.path.exists(p) else 0
    read_kw = {}
    if nrows is not None:
        read_kw["nrows"] = int(nrows)
        print(f"Reading up to {nrows} rows for variable detection", file=sys.stderr)
    elif file_size > LARGE_FILE_BYTES:
        print(
            f"Large file ({file_size // (1024 * 1024)} MB): loading up to {MAX_ANALYSIS_ROWS} rows",
            file=sys.stderr,
        )

    if p.lower().endswith(".csv"):
        print("📄 Detected CSV format", file=sys.stderr)
        df = pd.read_csv(p, **read_kw)
    elif p.lower().endswith((".xlsx", ".xls")):
        print("📄 Detected Excel format", file=sys.stderr)
        try:
            df = pd.read_excel(p, engine="openpyxl", **read_kw)
        except Exception:
            df = pd.read_excel(p, **read_kw)
    else:
        raise ValueError(f"Unsupported file format: {p}. Use CSV or Excel (.xlsx, .xls).")

    df = _clean_dataframe(df)
    if cap_rows and len(df) > MAX_ANALYSIS_ROWS:
        print(f"⚠️ Capping dataset to {MAX_ANALYSIS_ROWS} rows for analysis", file=sys.stderr)
        df = df.iloc[:MAX_ANALYSIS_ROWS].copy()

    print(f"📊 Loaded columns ({len(df.columns)}): {list(df.columns)[:30]}...", file=sys.stderr)
    print(f"📈 Dataset shape: {df.shape}", file=sys.stderr)
    return df

def find_student_col(df):
    for c in df.columns:
        if str(c).strip().lower() in STUDENT_COL_ALIASES:
            return c
    return None

def normalize_numeric(df):
    df = df.replace(r"^\s*$", np.nan, regex=True)
    for col in list(df.columns):
        if _is_metadata_column(col):
            continue
        converted = pd.to_numeric(df[col], errors="coerce")
        if converted.notna().sum() > 0:
            df[col] = converted
    return df

# ----------------------------
# Construct detection
# ----------------------------
def detect_constructs(df):
    """Automatically detect constructs/sections from any dataset format"""
    constructs = {}
    col_map = {str(col).strip().upper(): str(col).strip() for col in df.columns}

    def cols_for_prefix(prefix):
        pat = re.compile(rf"^{re.escape(prefix)}\d+$", re.IGNORECASE)
        out = [original for upper, original in col_map.items() if pat.match(upper)]
        out.sort(key=lambda x: int(''.join(filter(str.isdigit, x))) if ''.join(filter(str.isdigit, x)) else 0)
        return out

    patterns = {
        'IC': cols_for_prefix('IC'),
        'OC': cols_for_prefix('OC'),
        'MC': cols_for_prefix('MC'),
        'I': cols_for_prefix('I'),
        'H': cols_for_prefix('H'),
        'B': cols_for_prefix('B'),
        'E': cols_for_prefix('E'),
        'INF': cols_for_prefix('INF'),
        'MG': cols_for_prefix('MG'),
        'UX': cols_for_prefix('UX'),
        'SQ': cols_for_prefix('SQ'),
        'SV': cols_for_prefix('SV'),
        'PE': cols_for_prefix('PE'),
        'EE': cols_for_prefix('EE'),
        'SI': cols_for_prefix('SI'),
        'FC': cols_for_prefix('FC'),
        'PU': cols_for_prefix('PU'),
    }

    for section, cols in patterns.items():
        if cols:
            constructs[section] = cols

    constructs = _merge_auto_prefix_constructs(df, constructs)

    print(f"🔍 Detected constructs: {list(constructs.keys())}", file=sys.stderr)
    for section, cols in constructs.items():
        print(f"📊 {section}: {cols}", file=sys.stderr)

    return constructs


def _is_existing_mean_column(col_name):
    """True if column looks like a pre-calculated mean already in the file (not item scores)."""
    col_s = str(col_name).strip()
    if re.match(r"^M_\w+$", col_s, re.IGNORECASE):
        return True
    if re.match(r"^M\d+$", col_s, re.IGNORECASE):
        return True
    return False


def _merge_auto_prefix_constructs(df, constructs):
    """Detect extra sections: groups of PREFIX+number columns (e.g. SQ1, SQ2)."""
    from collections import defaultdict

    used = set()
    for cols in constructs.values():
        used.update(cols)

    groups = defaultdict(list)
    item_pat = re.compile(r"^([A-Za-z][A-Za-z0-9]{0,12})(\d+)$", re.IGNORECASE)

    for col in df.columns:
        col_s = str(col).strip()
        if not col_s or col_s in used or _is_metadata_column(col_s):
            continue
        if _is_existing_mean_column(col_s):
            continue
        series = pd.to_numeric(df[col], errors="coerce")
        if series.notna().sum() < 2:
            continue
        m = item_pat.match(col_s)
        if not m:
            continue
        prefix = m.group(1).upper()
        if prefix in constructs:
            continue
        groups[prefix].append(col_s)

    for prefix, cols in groups.items():
        if len(cols) >= 2:
            cols.sort(
                key=lambda x: int("".join(filter(str.isdigit, x)))
                if "".join(filter(str.isdigit, x))
                else 0
            )
            constructs[prefix] = cols

    return constructs

def build_construct_means(df, constructs):
    """Calculate section means with M_IC, M_OC format for all detected constructs"""
    mean_vars = []
    
    for section, items in constructs.items():
        if len(items) >= 2:  # Only calculate mean if section has 2+ items
            # Calculate mean of all items in this section
            valid_items = [item for item in items if item in df.columns]
            if len(valid_items) >= 2:
                # Use M_IC format instead of IC_mean
                section_mean = f"M_{section}"
                df[section_mean] = df[valid_items].mean(axis=1)
                mean_vars.append(section_mean)
                print(f"📊 Created {section_mean} from {valid_items}", file=sys.stderr)
    
    print(f"✅ Created section means: {mean_vars}", file=sys.stderr)
    return mean_vars

# ----------------------------
# Sales / Business Dataset Analytics
# ----------------------------
SALES_METRIC_HINTS = re.compile(
    r"(sales|revenue|profit|price|cost|cogs|margin|spend|units?_?sold|qty|quantity|amount|discount)",
    re.IGNORECASE,
)
SALES_DIMENSION_HINTS = re.compile(
    r"(region|country|city|state|sales_?person|customer_?type|channel|promotion|"
    r"category|brand|product|sku|segment|store|branch)",
    re.IGNORECASE,
)
SALES_TIME_HINTS = re.compile(
    r"(^year$|^quarter$|^month$|month_?name|^date$|order_?date|^week$|^day$)",
    re.IGNORECASE,
)


def _safe_num(v):
    """Convert a numpy/pandas scalar to a JSON-safe python float (NaN/inf -> None)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if np.isnan(f) or np.isinf(f):
        return None
    return f


def detect_dataset_type(df):
    """
    Heuristically classify an uploaded dataset as:
      - 'sales'  : transactional/business data (categorical dimensions + numeric metrics)
      - 'survey' : Likert-style item data with constructs (IC1, IC2, MC1, …)
      - 'unknown': not enough signal either way
    """
    cols = [str(c) for c in df.columns]
    constructs = detect_constructs(df)
    construct_item_count = sum(len(v) for v in constructs.values())

    metric_cols, dim_cols, date_cols = [], [], []
    for c in cols:
        if _is_metadata_column(c):
            continue
        series = df[c]
        numeric_series = pd.to_numeric(series, errors="coerce")
        is_mostly_numeric = bool(len(series)) and numeric_series.notna().mean() > 0.6

        is_date = False
        if SALES_TIME_HINTS.search(c):
            is_date = True
        elif not is_mostly_numeric:
            try:
                parsed = pd.to_datetime(series, errors="coerce")
                if len(series) and parsed.notna().mean() > 0.6:
                    is_date = True
            except Exception:
                is_date = False

        if is_date:
            date_cols.append(c)
            continue

        if is_mostly_numeric:
            metric_cols.append(c)
        else:
            try:
                nunique = int(series.nunique(dropna=True))
            except Exception:
                nunique = 0
            if 1 < nunique <= max(200, int(len(df) * 0.5) + 1):
                dim_cols.append(c)

    sales_keyword_score = sum(
        1 for c in cols if SALES_METRIC_HINTS.search(c) or SALES_DIMENSION_HINTS.search(c)
    )

    is_sales_like = (
        sales_keyword_score >= 3
        and len(metric_cols) >= 1
        and len(dim_cols) >= 1
        and construct_item_count == 0
    )
    is_survey_like = construct_item_count >= 2

    if is_sales_like and not is_survey_like:
        dataset_type, confidence = "sales", 0.9
    elif is_survey_like and not is_sales_like:
        dataset_type, confidence = "survey", 0.9
    elif is_sales_like and is_survey_like:
        dataset_type, confidence = "sales", 0.6
    elif len(metric_cols) >= 1 and len(dim_cols) >= 1:
        dataset_type, confidence = "sales", 0.4
    else:
        dataset_type, confidence = "unknown", 0.3

    return {
        "datasetType": dataset_type,
        "confidence": confidence,
        "metricColumns": metric_cols,
        "dimensionColumns": dim_cols,
        "dateColumns": date_cols,
    }


def action_detect_type(payload=None):
    """Inspect an uploaded file and suggest whether it's a sales/business dataset
    or a Likert/survey dataset, plus candidate dimension/metric/date columns."""
    payload = payload or {}
    custom_excel_path = payload.get("excelPath")
    df = load_df(custom_excel_path, nrows=DETECT_VARIABLES_ROWS, cap_rows=True)

    info = detect_dataset_type(df)

    dims_meta = []
    for c in info["dimensionColumns"]:
        try:
            card = int(df[c].nunique(dropna=True))
        except Exception:
            card = None
        dims_meta.append({"name": c, "cardinality": card})
    dims_meta.sort(key=lambda d: (d["cardinality"] if d["cardinality"] is not None else 99999))

    metrics_meta = [{"name": c} for c in info["metricColumns"]]

    return {
        "ok": True,
        "datasetType": info["datasetType"],
        "confidence": info["confidence"],
        "dimensions": dims_meta,
        "metrics": metrics_meta,
        "dateColumns": info["dateColumns"],
        "rowCount": int(len(df)),
        "columnCount": int(len(df.columns)),
    }


MONTH_ORDER = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]


def _sort_chronologically(grouped, dimension):
    """Sort a groupby result chronologically when the dimension looks like a time column."""
    dim_lower = str(dimension).strip().lower()
    try:
        if dim_lower == "month_name":
            order = {m.lower(): i for i, m in enumerate(MONTH_ORDER)}
            grouped = grouped.copy()
            grouped["_sort_key"] = grouped[dimension].astype(str).str.lower().map(order)
            grouped = grouped.sort_values("_sort_key").drop(columns="_sort_key")
            return grouped
        if dim_lower in ("year", "quarter", "month", "week", "day"):
            grouped = grouped.copy()
            extracted = grouped[dimension].astype(str).str.extract(r"(\d+)")[0]
            grouped["_sort_key"] = pd.to_numeric(extracted, errors="coerce")
            grouped = grouped.sort_values("_sort_key").drop(columns="_sort_key")
            return grouped
    except Exception:
        pass
    return grouped.sort_values(dimension)


def _top_n_with_other(labels, values, top_n):
    """Sort categorical labels by value desc, group anything past top_n into 'Other'."""
    pairs = list(zip(labels, values))
    pairs.sort(key=lambda p: (p[1] if p[1] is not None else 0), reverse=True)
    if top_n and len(pairs) > top_n:
        top = pairs[:top_n]
        rest = pairs[top_n:]
        other_sum = sum((v or 0) for _, v in rest)
        top.append(("Other", other_sum))
        pairs = top
    return [p[0] for p in pairs], [p[1] for p in pairs]


def action_sales_aggregate(payload):
    """Group a sales/business dataset by one dimension and aggregate a metric —
    powers the 'country wise / region wise / product wise …' breakdown charts."""
    payload = payload or {}
    custom_excel_path = payload.get("excelPath")
    dimension = payload.get("dimension")
    metric = payload.get("metric")
    aggregation = str(payload.get("aggregation") or "sum").lower()
    top_n = payload.get("topN", 10)
    try:
        top_n = int(top_n) if top_n else None
    except (TypeError, ValueError):
        top_n = 10

    if not dimension or not metric:
        return {"ok": False, "error": "Both a dimension (group by) and a metric are required."}

    df = load_df(custom_excel_path)

    if dimension not in df.columns or metric not in df.columns:
        return {
            "ok": False,
            "error": f"Column not found. dimension='{dimension}', metric='{metric}'",
            "availableColumns": list(df.columns),
        }

    work = df[[dimension, metric]].copy()
    work[metric] = pd.to_numeric(work[metric], errors="coerce")
    work = work.dropna(subset=[dimension])
    work[dimension] = work[dimension].astype(str).replace({"nan": "Unknown", "": "Unknown"})

    agg_map = {
        "sum": "sum", "mean": "mean", "avg": "mean", "average": "mean",
        "count": "count", "median": "median", "max": "max", "min": "min",
    }
    agg_func = agg_map.get(aggregation, "sum")

    if agg_func == "count":
        grouped = work.groupby(dimension)[metric].count().reset_index()
    else:
        grouped = work.groupby(dimension)[metric].agg(agg_func).reset_index()

    dim_lower = str(dimension).strip().lower()
    is_time_dim = dim_lower in ("year", "quarter", "month", "month_name", "week", "day")

    if is_time_dim:
        grouped = _sort_chronologically(grouped, dimension)
        labels = grouped[dimension].astype(str).tolist()
        values = [_safe_num(v) for v in grouped[metric].tolist()]
    else:
        labels = grouped[dimension].astype(str).tolist()
        values = [_safe_num(v) for v in grouped[metric].tolist()]
        labels, values = _top_n_with_other(labels, values, top_n)

    total = _safe_num(work[metric].sum()) if agg_func != "count" else int(work[metric].count())
    average = _safe_num(work[metric].mean()) if len(work) else None

    return {
        "ok": True,
        "dimension": dimension,
        "metric": metric,
        "aggregation": agg_func,
        "labels": labels,
        "values": values,
        "rowCount": int(len(work)),
        "groupCount": int(grouped.shape[0]),
        "total": total,
        "average": average,
        "isTimeDimension": is_time_dim,
    }


FREQ_MAP = {
    "D": "D", "DAY": "D", "DAILY": "D",
    "W": "W", "WEEK": "W", "WEEKLY": "W",
    "M": "M", "MONTH": "M", "MONTHLY": "M",
    "Q": "Q", "QUARTER": "Q", "QUARTERLY": "Q",
    "Y": "Y", "YEAR": "Y", "ANNUAL": "Y", "YEARLY": "Y",
}
FREQ_LABEL = {"D": "day", "W": "week", "M": "month", "Q": "quarter", "Y": "year"}
# pandas 2.2+ removed the bare 'M'/'Q'/'Y' offset aliases in favour of period-end variants.
PANDAS_FREQ_ALIAS = {"D": "D", "W": "W", "M": "ME", "Q": "QE", "Y": "YE"}


def _format_period_label(period, freq):
    try:
        if freq == "M":
            return period.strftime("%b %Y")
        if freq == "Q":
            return f"Q{period.quarter} {period.year}"
        if freq == "Y":
            return str(period.year)
        if freq == "W":
            return period.strftime("%d %b %Y")
        return period.strftime("%d %b %Y")
    except Exception:
        return str(period)


def action_forecast(payload):
    """Forecast a sales metric forward in time using Holt-Winters / Holt linear trend
    (falls back to a simple linear regression if statsmodels can't fit the series)."""
    payload = payload or {}
    custom_excel_path = payload.get("excelPath")
    date_col = payload.get("dateColumn") or "Order_Date"
    metric = payload.get("metric")
    freq_raw = str(payload.get("freq") or "M").upper()
    freq = FREQ_MAP.get(freq_raw, "M")
    periods = payload.get("periods", 12)
    try:
        periods = max(1, min(60, int(periods)))
    except (TypeError, ValueError):
        periods = 12
    filter_column = payload.get("filterColumn")
    filter_value = payload.get("filterValue")

    if not metric:
        return {"ok": False, "error": "A metric column is required for forecasting."}

    df = load_df(custom_excel_path)

    if date_col not in df.columns:
        return {"ok": False, "error": f"Date column '{date_col}' not found.", "availableColumns": list(df.columns)}
    if metric not in df.columns:
        return {"ok": False, "error": f"Metric column '{metric}' not found.", "availableColumns": list(df.columns)}

    work = df[[date_col, metric]].copy()
    if filter_column and filter_value is not None and filter_column in df.columns:
        mask = df[filter_column].astype(str) == str(filter_value)
        work = work[mask]

    work[date_col] = pd.to_datetime(work[date_col], errors="coerce")
    work[metric] = pd.to_numeric(work[metric], errors="coerce")
    work = work.dropna(subset=[date_col, metric])

    if len(work) < 4:
        return {"ok": False, "error": "Not enough dated rows to build a forecast (need at least 4 time periods)."}

    series = work.set_index(date_col)[metric].sort_index().resample(PANDAS_FREQ_ALIAS[freq]).sum()
    series = series.fillna(0.0)

    if len(series) < 4:
        return {"ok": False, "error": f"Not enough {FREQ_LABEL.get(freq, 'period')}s of history to forecast (need at least 4)."}

    n = len(series)
    seasonal_periods = {"M": 12, "Q": 4, "D": 7, "W": 52}.get(freq)
    use_seasonal = bool(seasonal_periods) and n >= max(seasonal_periods * 2, 10)
    model_name = "Linear trend"
    resid_std = None

    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        if use_seasonal:
            fitted_model = ExponentialSmoothing(
                series, trend="add", seasonal="add", seasonal_periods=seasonal_periods,
                initialization_method="estimated",
            ).fit()
            model_name = "Holt-Winters (trend + seasonality)"
        else:
            fitted_model = ExponentialSmoothing(
                series, trend="add", seasonal=None, initialization_method="estimated",
            ).fit()
            model_name = "Holt linear trend"
        fitted_vals = fitted_model.fittedvalues
        resid_std = float(np.std(series.values - fitted_vals.values)) if len(fitted_vals) else None
        forecast_values = np.asarray(fitted_model.forecast(periods), dtype=float)
    except Exception as e:
        print(f"⚠️ Holt-Winters failed, falling back to linear regression: {e}", file=sys.stderr)
        x = np.arange(n)
        coeffs = np.polyfit(x, series.values, 1)
        trend_fit = np.polyval(coeffs, x)
        resid_std = float(np.std(series.values - trend_fit)) if n else None
        future_x = np.arange(n, n + periods)
        forecast_values = np.polyval(coeffs, future_x)
        model_name = "Linear regression (fallback)"

    forecast_values = np.clip(forecast_values, 0, None)

    future_index = pd.date_range(start=series.index[-1], periods=periods + 1, freq=PANDAS_FREQ_ALIAS[freq])[1:]
    ci_margin = 1.96 * resid_std if resid_std else 0.0

    historical_labels = [_format_period_label(p, freq) for p in series.index]
    historical_values = [_safe_num(v) for v in series.values]

    forecast_labels = [_format_period_label(p, freq) for p in future_index]
    forecast_vals = [_safe_num(v) for v in forecast_values]
    forecast_lower = [_safe_num(max(0.0, v - ci_margin)) for v in forecast_values]
    forecast_upper = [_safe_num(v + ci_margin) for v in forecast_values]

    hist_avg = float(np.mean(series.values)) if n else 0.0
    forecast_avg = float(np.mean(forecast_values)) if len(forecast_values) else 0.0
    pct_change = ((forecast_avg - hist_avg) / hist_avg * 100.0) if hist_avg else None

    return {
        "ok": True,
        "metric": metric,
        "dateColumn": date_col,
        "freq": freq,
        "freqLabel": FREQ_LABEL.get(freq, "period"),
        "periods": periods,
        "model": model_name,
        "historical": {"labels": historical_labels, "values": historical_values},
        "forecast": {
            "labels": forecast_labels,
            "values": forecast_vals,
            "lower": forecast_lower,
            "upper": forecast_upper,
        },
        "summary": {
            "historicalAverage": _safe_num(hist_avg),
            "forecastAverage": _safe_num(forecast_avg),
            "forecastTotal": _safe_num(float(np.sum(forecast_values))) if len(forecast_values) else None,
            "percentChange": _safe_num(pct_change) if pct_change is not None else None,
        },
        "rowCount": int(len(work)),
    }


# ----------------------------
# Outlier Detection & Visualization
# ----------------------------
def detect_outliers_iqr(df, column):
    """Detect outliers using IQR method"""
    Q1 = df[column].quantile(0.25)
    Q3 = df[column].quantile(0.75)
    IQR = Q3 - Q1
    lower_bound = Q1 - 1.5 * IQR
    upper_bound = Q3 + 1.5 * IQR
    outliers = df[(df[column] < lower_bound) | (df[column] > upper_bound)]
    return outliers.index.tolist()

def detect_outliers_zscore(df, column, threshold=3):
    """Detect outliers using Z-score method"""
    z_scores = np.abs((df[column] - df[column].mean()) / df[column].std())
    outliers = df[z_scores > threshold]
    return outliers.index.tolist()

def create_outlier_visualizations(df, column, outlier_indices=None):
    """Create before/after outlier removal visualizations"""
    import matplotlib.pyplot as plt
    import io
    import base64
    
    df_clean = df.drop(outlier_indices) if outlier_indices else df.copy()
    
    # Create subplots for before/after comparison
    fig, axes = plt.subplots(2, 3, figsize=(15, 10))
    fig.suptitle(f'Outlier Analysis for {column}', fontsize=16)
    
    # P-P Plot (Before)
    from scipy import stats
    stats.probplot(df[column].dropna(), dist="norm", plot=axes[0, 0])
    axes[0, 0].set_title('P-P Plot (Before)')
    
    # Histogram (Before)
    axes[0, 1].hist(df[column].dropna(), bins=20, alpha=0.7, color='blue')
    axes[0, 1].set_title('Histogram (Before)')
    axes[0, 1].set_xlabel(column)
    axes[0, 1].set_ylabel('Frequency')
    
    # Box Plot (Before)
    axes[0, 2].boxplot(df[column].dropna())
    axes[0, 2].set_title('Box Plot (Before)')
    axes[0, 2].set_ylabel(column)
    
    # P-P Plot (After)
    if outlier_indices:
        stats.probplot(df_clean[column].dropna(), dist="norm", plot=axes[1, 0])
        axes[1, 0].set_title('P-P Plot (After)')
    else:
        axes[1, 0].text(0.5, 0.5, 'No outliers removed', ha='center', va='center', transform=axes[1, 0].transAxes)
        axes[1, 0].set_title('P-P Plot (After)')
    
    # Histogram (After)
    if outlier_indices:
        axes[1, 1].hist(df_clean[column].dropna(), bins=20, alpha=0.7, color='green')
        axes[1, 1].set_title('Histogram (After)')
        axes[1, 1].set_xlabel(column)
        axes[1, 1].set_ylabel('Frequency')
    else:
        axes[1, 1].text(0.5, 0.5, 'No outliers removed', ha='center', va='center', transform=axes[1, 1].transAxes)
        axes[1, 1].set_title('Histogram (After)')
    
    # Box Plot (After)
    if outlier_indices:
        axes[1, 2].boxplot(df_clean[column].dropna())
        axes[1, 2].set_title('Box Plot (After)')
        axes[1, 2].set_ylabel(column)
    else:
        axes[1, 2].text(0.5, 0.5, 'No outliers removed', ha='center', va='center', transform=axes[1, 2].transAxes)
        axes[1, 2].set_title('Box Plot (After)')
    
    plt.tight_layout()
    
    # Convert to base64
    buffer = io.BytesIO()
    plt.savefig(buffer, format='png', dpi=100, bbox_inches='tight')
    buffer.seek(0)
    image_base64 = base64.b64encode(buffer.getvalue()).decode()
    plt.close()
    
    return image_base64

def action_outlier_analysis(payload):
    """Handle outlier analysis requests"""
    df = load_df()
    df = normalize_numeric(df)
    
    column = payload.get("column")
    method = payload.get("method", "iqr")  # iqr or zscore
    remove_outliers = payload.get("removeOutliers", False)
    
    if not column or column not in df.columns:
        return {"ok": False, "error": "Invalid column specified"}
    
    # Detect outliers
    if method == "iqr":
        outlier_indices = detect_outliers_iqr(df, column)
    else:
        outlier_indices = detect_outliers_zscore(df, column)
    
    # Create visualizations
    visualization = create_outlier_visualizations(df, column, outlier_indices if remove_outliers else None)
    
    # Calculate statistics before and after
    original_stats = {
        "mean": float(df[column].mean()),
        "std": float(df[column].std()),
        "count": int(df[column].count()),
        "min": float(df[column].min()),
        "max": float(df[column].max())
    }
    
    if remove_outliers and outlier_indices:
        df_clean = df.drop(outlier_indices)
        cleaned_stats = {
            "mean": float(df_clean[column].mean()),
            "std": float(df_clean[column].std()),
            "count": int(df_clean[column].count()),
            "min": float(df_clean[column].min()),
            "max": float(df_clean[column].max())
        }
    else:
        cleaned_stats = original_stats
    
    return {
        "ok": True,
        "column": column,
        "method": method,
        "outlierCount": len(outlier_indices),
        "outlierIndices": outlier_indices,
        "originalStats": original_stats,
        "cleanedStats": cleaned_stats,
        "visualization": visualization,
        "outliersRemoved": remove_outliers
    }
def cronbach_alpha(items_df: pd.DataFrame):
    items_df = items_df.dropna()
    if items_df.shape[1] < 2 or len(items_df) < 2:
        return np.nan
    variances = items_df.var(axis=0, ddof=1)
    total_var = items_df.sum(axis=1).var(ddof=1)
    n = items_df.shape[1]
    if total_var == 0 or np.isnan(total_var):
        return np.nan
    return (n / (n - 1)) * (1 - variances.sum() / total_var)

def compute_ave(df, constructs):
    """
    AVE using squared item-construct correlations (with construct mean).
    """
    ave_values = {}
    for prefix, items in constructs.items():
        mean_col = f"{prefix}M"
        if mean_col not in df.columns or len(items) < 2:
            continue

        loadings_sq = []
        for item in items:
            valid = df[[item, mean_col]].dropna()
            if len(valid) < 2:
                continue
            corr = np.corrcoef(valid[item], valid[mean_col])[0, 1]
            if np.isnan(corr):
                continue
            loadings_sq.append(corr ** 2)

        if loadings_sq:
            ave_values[prefix] = float(np.mean(loadings_sq))

    return ave_values

def fornell_larcker(mean_corr, ave_values):
    fl = mean_corr.copy()
    for prefix, ave in ave_values.items():
        mean_col = f"{prefix}M"
        if mean_col in fl.index and mean_col in fl.columns:
            fl.loc[mean_col, mean_col] = np.sqrt(ave)
    return fl

# ----------------------------
# Excel Export & Visualization
# ----------------------------
def create_analysis_data(df, constructs, mean_vars, alphas, ave_values, corr_matrix, fl_matrix, regression_results):
    """
    Create analysis data without saving to files
    """
    # Create overview data
    overview_data = {
        'Metric': ['Total Rows', 'Total Columns', 'Constructs Identified', 'Mean Variables Created'],
        'Value': [len(df), len(df.columns), len(constructs), len(mean_vars)]
    }
    
    # Create construct details data
    construct_data = []
    for prefix, items in constructs.items():
        construct_data.append({
            'Construct': prefix,
            'Items': ', '.join(items),
            'Number of Items': len(items),
            'Cronbach Alpha': f"{alphas.get(prefix, 'N/A'):.3f}" if alphas.get(prefix) else 'N/A',
            'AVE': f"{ave_values.get(prefix, 'N/A'):.3f}" if ave_values.get(prefix) else 'N/A'
        })
    
    # Create regression data
    reg_data = []
    if regression_results and regression_results.get('ok'):
        for coeff in regression_results['coefficients']:
            reg_data.append({
                'Variable': coeff['term'],
                'Beta': f"{coeff['beta']:.4f}",
                't-value': f"{coeff['t_value']:.4f}",
                'p-value': f"{coeff['p_value']:.4f}"
            })
        
        # Add model statistics
        reg_data.append({
            'Variable': 'Model Statistics',
            'Beta': f"R² = {regression_results['r2']:.3f}",
            't-value': f"Adj R² = {regression_results['adj_r2']:.3f}",
            'p-value': f"F p-value = {regression_results['f_pvalue']:.4f}" if regression_results['f_p_value'] else 'N/A'
        })
    
    return {
        'overview': overview_data,
        'construct_details': construct_data,
        'correlation_matrix': corr_matrix.to_dict() if not corr_matrix.empty else {},
        'fornell_larcker': fl_matrix.to_dict() if not fl_matrix.empty else {},
        'regression_results': reg_data,
        'raw_data': df.to_dict('records') if len(df) > 0 else []
    }

def create_visualizations(df, constructs, mean_vars, corr_matrix, regression_results, ave_values=None, dependent=None):
    """
    Create visualization plots and return as base64 encoded images
    """
    plots = {}
    
    # Set style
    plt.style.use('seaborn-v0_8')
    
    # 1. Correlation Heatmap
    if not corr_matrix.empty:
        plt.figure(figsize=(10, 8))
        sns.heatmap(corr_matrix, annot=True, cmap='coolwarm', center=0, 
                   square=True, fmt='.3f', cbar_kws={'shrink': 0.8})
        plt.title('Construct Correlation Matrix', fontsize=16, fontweight='bold')
        plt.tight_layout()
        
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        plots['correlation_heatmap'] = base64.b64encode(buffer.getvalue()).decode()
        plt.close()
    
    # 2. Cronbach Alpha Chart
    alphas = {}
    for prefix, items in constructs.items():
        alpha = cronbach_alpha(df[items])
        if not np.isnan(alpha):
            alphas[prefix] = alpha
    
    if alphas:
        plt.figure(figsize=(10, 6))
        constructs_list = list(alphas.keys())
        alpha_values = list(alphas.values())
        
        colors = ['green' if alpha >= 0.7 else 'orange' if alpha >= 0.6 else 'red' for alpha in alpha_values]
        bars = plt.bar(constructs_list, alpha_values, color=colors, alpha=0.7)
        
        plt.axhline(y=0.7, color='green', linestyle='--', alpha=0.7, label='Good (≥0.7)')
        plt.axhline(y=0.6, color='orange', linestyle='--', alpha=0.7, label='Acceptable (≥0.6)')
        
        plt.xlabel('Constructs', fontsize=12)
        plt.ylabel('Cronbach\'s Alpha', fontsize=12)
        plt.title('Reliability Analysis - Cronbach\'s Alpha', fontsize=16, fontweight='bold')
        plt.legend()
        plt.xticks(rotation=45)
        
        # Add value labels on bars
        for bar, value in zip(bars, alpha_values):
            plt.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01, 
                    f'{value:.3f}', ha='center', va='bottom')
        
        plt.tight_layout()
        
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        plots['cronbach_alpha'] = base64.b64encode(buffer.getvalue()).decode()
        plt.close()
    
    # 3. AVE Chart
    if ave_values:
        plt.figure(figsize=(10, 6))
        constructs_list = list(ave_values.keys())
        ave_values_list = list(ave_values.values())
        
        colors = ['green' if ave >= 0.5 else 'red' for ave in ave_values_list]
        bars = plt.bar(constructs_list, ave_values_list, color=colors, alpha=0.7)
        
        plt.axhline(y=0.5, color='green', linestyle='--', alpha=0.7, label='Threshold (≥0.5)')
        
        plt.xlabel('Constructs', fontsize=12)
        plt.ylabel('Average Variance Extracted (AVE)', fontsize=12)
        plt.title('Convergent Validity - AVE Values', fontsize=16, fontweight='bold')
        plt.legend()
        plt.xticks(rotation=45)
        
        # Add value labels on bars
        for bar, value in zip(bars, ave_values_list):
            plt.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01, 
                    f'{value:.3f}', ha='center', va='bottom')
        
        plt.tight_layout()
        
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        plots['ave_values'] = base64.b64encode(buffer.getvalue()).decode()
        plt.close()
    
    # 4. Regression Plots
    if regression_results and regression_results.get('ok'):
        independents = regression_results.get('independents', [])
        dv = regression_results['dependent']
        
        # Single IV - Scatter plot with regression line
        if len(independents) == 1:
            iv = independents[0]
            
            # Get clean data for plotting
            data_reg = df[[dv, iv]].dropna()
            X = sm.add_constant(data_reg[iv])
            y = data_reg[dv]
            model = sm.OLS(y, X).fit()
            
            # Calculate residuals and z-scores
            data_reg = data_reg.copy()
            data_reg["Residual"] = model.resid
            data_reg["Z_Residual"] = zscore(data_reg["Residual"], nan_policy="omit")
            data_clean = data_reg[np.abs(data_reg["Z_Residual"]) <= 3]
            
            plt.figure(figsize=(10, 6))
            plt.scatter(data_clean[iv], data_clean[dv], alpha=0.6, s=50, color='blue', label='Data Points')
            
            # Add regression line
            x_line = np.linspace(data_clean[iv].min(), data_clean[iv].max(), 100)
            y_line = model.params[0] + model.params[1] * x_line
            plt.plot(x_line, y_line, 'r-', linewidth=2, label='Regression Line')
            
            plt.xlabel(iv, fontsize=12)
            plt.ylabel(dv, fontsize=12)
            plt.title(f'Regression: {iv} → {dv}', fontsize=16, fontweight='bold')
            plt.legend()
            plt.grid(True, alpha=0.3)
            
            # Add R² to plot
            plt.text(0.05, 0.95, f'R² = {model.rsquared:.3f}', transform=plt.gca().transAxes, 
                    bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.8),
                    fontsize=12, verticalalignment='top')
            
            plt.tight_layout()
            
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            plots['regression_plot'] = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
        
        # Multiple IVs - Create coefficient plot and residual analysis
        if len(independents) >= 1:
            # Coefficient Plot (works for single and multiple IVs)
            plt.figure(figsize=(10, 6))
            coeffs = regression_results['coefficients']
            iv_coeffs = [c for c in coeffs if c['term'] != 'const']
            
            if iv_coeffs:
                terms = [c['term'] for c in iv_coeffs]
                betas = [c['beta'] for c in iv_coeffs]
                p_values = [c['p_value'] for c in iv_coeffs]
                
                # Color based on significance
                colors = ['red' if p < 0.05 else 'lightgray' for p in p_values]
                
                bars = plt.barh(terms, betas, color=colors, alpha=0.7)
                
                # Add value labels
                for i, (bar, beta) in enumerate(zip(bars, betas)):
                    plt.text(bar.get_width() + (0.01 if beta >= 0 else -0.01), bar.get_y() + bar.get_height()/2, 
                            f'{beta:.3f}', ha='left' if beta >= 0 else 'right', va='center')
                
                plt.xlabel('Standardized Coefficient (β)', fontsize=12)
                plt.ylabel('Variables', fontsize=12)
                plt.title('Regression Coefficients', fontsize=16, fontweight='bold')
                plt.axvline(x=0, color='black', linestyle='-', alpha=0.3)
                plt.grid(True, alpha=0.3, axis='x')
                
                # Add legend for significance
                from matplotlib.patches import Patch
                legend_elements = [Patch(facecolor='red', alpha=0.7, label='Significant (p < 0.05)'),
                                 Patch(facecolor='lightgray', alpha=0.7, label='Not Significant')]
                plt.legend(handles=legend_elements)
                
                plt.tight_layout()
                
                buffer = io.BytesIO()
                plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
                buffer.seek(0)
                plots['coefficients_plot'] = base64.b64encode(buffer.getvalue()).decode()
                plt.close()
            
            # Residuals Plot (for any regression)
            if len(independents) == 1:
                # For single IV, we can create residuals vs fitted plot
                iv = independents[0]
                data_reg = df[[dv, iv]].dropna()
                X = sm.add_constant(data_reg[iv])
                y = data_reg[dv]
                model = sm.OLS(y, X).fit()
                
                fitted_values = model.fittedvalues
                residuals = model.resid
                
                plt.figure(figsize=(10, 6))
                plt.scatter(fitted_values, residuals, alpha=0.6, s=50, color='blue')
                plt.axhline(y=0, color='red', linestyle='--', alpha=0.8)
                
                plt.xlabel('Fitted Values', fontsize=12)
                plt.ylabel('Residuals', fontsize=12)
                plt.title('Residuals vs Fitted Values', fontsize=16, fontweight='bold')
                plt.grid(True, alpha=0.3)
                
                # Add reference line at y=0
                plt.axhline(y=0, color='red', linestyle='--', alpha=0.8, label='Zero Line')
                plt.legend()
                
                plt.tight_layout()
                
                buffer = io.BytesIO()
                plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
                buffer.seek(0)
                plots['residuals_plot'] = base64.b64encode(buffer.getvalue()).decode()
                plt.close()
            
            # Model Summary Plot
            plt.figure(figsize=(10, 6))
            
            # Create a summary text
            r2 = regression_results.get('r2', 0)
            adj_r2 = regression_results.get('adj_r2', 0)
            f_pvalue = regression_results.get('f_pvalue', None)
            rows_used = regression_results.get('rows_used', 0)
            rows_removed = regression_results.get('rows_removed_outliers', 0)
            
            summary_text = f"""Model Summary:
            
R² = {r2:.3f}
Adjusted R² = {adj_r2:.3f}
Sample Size = {rows_used}
Outliers Removed = {rows_removed}

F-test p-value = {f_pvalue:.4f}' if f_pvalue is not None else 'F-test p-value = N/A'

Variables: {len(independents)}
Dependent: {dv}
Independents: {', '.join(independents)}"""
            
            plt.text(0.1, 0.5, summary_text, fontsize=12, verticalalignment='center',
                    bbox=dict(boxstyle="round,pad=0.5", facecolor="lightblue", alpha=0.8))
            plt.axis('off')
            plt.title('Regression Model Summary', fontsize=16, fontweight='bold')
            
            plt.tight_layout()
            
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            plots['model_summary'] = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
    
    # 4. Combined Variable Distribution Plots (P-P plot, Histogram, Box Plot)
    all_vars = independents.copy()
    if dependent and dependent not in all_vars:
        all_vars.append(dependent)
    
    if all_vars:
        # Combined P-P Plot for all selected variables
        plt.figure(figsize=(12, 8))
        colors = plt.cm.Set3(np.linspace(0, 1, len(all_vars)))
        
        for i, var in enumerate(all_vars):
            if var in df.columns:
                data_var = df[var].dropna()
                if len(data_var) > 0:
                    stats.probplot(data_var, dist="norm", plot=plt)
                    plt.title(f'Combined P-P Plot: All Selected Variables', fontsize=16, fontweight='bold')
                    plt.xlabel('Theoretical Quantiles', fontsize=12)
                    plt.ylabel('Sample Quantiles', fontsize=12)
                    plt.grid(True, alpha=0.3)
                    
                    # Add legend to show which variable is which
                    plt.text(0.05, 0.95 - i*0.05, f'● {var}', transform=plt.gca().transAxes,
                            fontsize=10, verticalalignment='top', color=colors[i])
        
        plt.tight_layout()
        
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        plots['combined_ppplot'] = base64.b64encode(buffer.getvalue()).decode()
        plt.close()

        qq_img = create_qqplot(df[[v for v in all_vars if v in df.columns]].dropna(), all_vars)
        if qq_img:
            plots['qqplot'] = qq_img
        
        # Combined Histogram for all selected variables
        plt.figure(figsize=(12, 8))
        
        for i, var in enumerate(all_vars):
            if var in df.columns:
                data_var = df[var].dropna()
                if len(data_var) > 0:
                    plt.hist(data_var, bins=30, alpha=0.6, color=colors[i], label=var, edgecolor='black')
        
        plt.title('Combined Histogram: All Selected Variables', fontsize=16, fontweight='bold')
        plt.xlabel('Values', fontsize=12)
        plt.ylabel('Frequency', fontsize=12)
        plt.legend()
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        plots['combined_histogram'] = base64.b64encode(buffer.getvalue()).decode()
        plt.close()
        
        # Combined Box Plot for all selected variables
        plt.figure(figsize=(12, 8))
        
        data_for_boxplot = []
        labels_for_boxplot = []
        
        for var in all_vars:
            if var in df.columns:
                data_var = df[var].dropna()
                if len(data_var) > 0:
                    data_for_boxplot.append(data_var)
                    labels_for_boxplot.append(var)
        
        if data_for_boxplot:
            box = plt.boxplot(data_for_boxplot, patch_artist=True, labels=labels_for_boxplot)
            
            # Color the boxes
            for patch, color in zip(box['boxes'], colors):
                patch.set_facecolor(color)
                patch.set_alpha(0.7)
        
        plt.title('Combined Box Plot: All Selected Variables', fontsize=16, fontweight='bold')
        plt.ylabel('Values', fontsize=12)
        plt.xticks(rotation=45)
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        plots['combined_boxplot'] = base64.b64encode(buffer.getvalue()).decode()
        plt.close()

    return plots

# ----------------------------
# Regression (with outlier removal)
# ----------------------------
def run_regression(df, dependent, independents):
    data = df[[dependent] + independents].dropna()

    if len(data) < (len(independents) + 3):
        return {
            "ok": False,
            "error": f"Not enough usable rows after cleaning: {len(data)}"
        }

    X = sm.add_constant(data[independents])
    y = data[dependent]
    model = sm.OLS(y, X).fit()

    data = data.copy()
    data["Residual"] = model.resid
    data["Z_Residual"] = zscore(data["Residual"], nan_policy="omit")

    clean = data[np.abs(data["Z_Residual"]) <= 3].dropna(subset=[dependent] + independents)

    if len(clean) < (len(independents) + 3):
        # fallback: if too few rows after outlier removal, return original model
        final_model = model
        used_rows = len(data)
        removed = int(len(data) - len(clean))
        used_clean = False
    else:
        final_model = sm.OLS(clean[dependent], sm.add_constant(clean[independents])).fit()
        used_rows = len(clean)
        removed = int(len(data) - len(clean))
        used_clean = True

    coeffs = []
    for term in final_model.params.index:
        coeffs.append({
            "term": term,
            "beta": float(final_model.params[term]),
            "t_value": float(final_model.tvalues[term]),
            "p_value": float(final_model.pvalues[term]),
        })

    return {
        "ok": True,
        "dependent": dependent,
        "independents": independents,
        "rows_used": int(used_rows),
        "rows_removed_outliers": int(removed),
        "used_outlier_cleaning": bool(used_clean),
        "r2": float(final_model.rsquared),
        "adj_r2": float(final_model.rsquared_adj),
        "f_pvalue": None if final_model.f_pvalue is None else float(final_model.f_pvalue),
        "coefficients": coeffs,
    }

# Actions
# ----------------------------
def _collect_numeric_analysis_variables(df, min_valid=1):
    """All usable numeric columns (any header names in uploaded files)."""
    variables = []
    for col in df.columns:
        col_s = str(col).strip()
        if not col_s or _is_metadata_column(col_s):
            continue
        series = pd.to_numeric(df[col], errors="coerce")
        valid = int(series.notna().sum())
        if valid < min_valid:
            continue
        if series.notna().mean() < 0.01:
            continue
        df[col] = series
        variables.append({
            "name": col_s,
            "type": "numeric",
            "description": "Numeric column from dataset",
        })
    return variables


def _collect_computed_section_means(df):
    """
    Only auto-calculated section means (M_IC, M_MC, …).
    Does not expose raw item columns (IC1, MC2) or mean columns already in the file.
    """
    constructs = detect_constructs(df)
    mean_vars = build_construct_means(df, constructs)

    variables = []
    for mv in mean_vars:
        if mv in df.columns:
            section = mv.replace("M_", "")
            variables.append({
                "name": mv,
                "type": "numeric",
                "description": f"Auto-calculated mean of section {section}",
            })
    return variables


def action_get_variables(payload=None):
    """Return auto-calculated section mean variables only (M_IC, M_MC, M_SQ, …)."""
    payload = payload or {}
    custom_excel_path = payload.get("excelPath")
    detect_only = bool(payload.get("detectOnly") or payload.get("source") == "dataset")

    df = load_df(
        custom_excel_path,
        nrows=DETECT_VARIABLES_ROWS if detect_only else None,
        cap_rows=True,
    )
    df = normalize_numeric(df)

    variables = _collect_computed_section_means(df)
    computed_means_only = True

    # Fallback: uploaded datasets without Likert-style construct naming (e.g. plain
    # numeric/business data) — expose raw numeric columns so regression can still run.
    if not variables and (detect_only or payload.get("flexible")):
        variables = _collect_numeric_analysis_variables(df)
        computed_means_only = False

    return {
        "ok": True,
        "variables": variables,
        "rowCount": int(len(df)),
        "columnCount": int(len(df.columns)),
        "computedMeansOnly": computed_means_only,
    }


def _format_regression_ui(regression_results):
    """Flatten regression output for the frontend."""
    if not regression_results or not regression_results.get("ok"):
        return {}
    coeffs = []
    for c in regression_results.get("coefficients", []):
        p = c.get("p_value")
        try:
            p_num = float(p) if p is not None else None
        except (TypeError, ValueError):
            p_num = None
        coeffs.append({
            "var": c.get("term"),
            "beta": c.get("beta"),
            "t": c.get("t_value"),
            "p": f"{p_num:.4f}" if p_num is not None else "N/A",
            "sig": p_num is not None and p_num < 0.05,
        })
    f_p = regression_results.get("f_pvalue")
    return {
        "r2": regression_results.get("r2"),
        "adjR2": regression_results.get("adj_r2"),
        "f": regression_results.get("f_stat"),
        "pValue": f"< {f_p:.4f}" if f_p is not None and f_p < 0.001 else (f"{f_p:.4f}" if f_p is not None else "N/A"),
        "coefficients": coeffs,
    }


def _viz_types_full(viz_types):
    if not viz_types:
        return True
    if isinstance(viz_types, str):
        viz_types = [viz_types]
    normalized = {str(v).lower() for v in viz_types}
    return "null" in normalized or "all" in normalized or "complete" in normalized

def action_metadata(payload=None):
    # Get custom Excel path if provided (for uploaded datasets)
    custom_excel_path = payload.get("excelPath") if payload else None
    skip_stats = payload.get("skipStats", False) if payload else False  # Skip heavy stats if requested
    
    df = load_df(custom_excel_path)
    student_col = find_student_col(df)
    df = normalize_numeric(df)

    constructs = detect_constructs(df)
    mean_vars = build_construct_means(df, constructs)

    # Use all section means as variables for analysis
    section_means = mean_vars
    
    # Set candidates to section means
    candidates = section_means

    # Initialize stats containers
    alphas = {}
    ave = {}
    mean_corr = {}
    fl = {}

    # Only calculate heavy statistics if not skipped
    if not skip_stats:
        # reliability
        for prefix, items in constructs.items():
            a = cronbach_alpha(df[items])
            alphas[prefix] = None if np.isnan(a) else float(a)

        # validity
        ave = compute_ave(df, constructs)
        mean_corr = df[mean_vars].corr() if len(mean_vars) else pd.DataFrame()
        fl = fornell_larcker(mean_corr, ave) if len(mean_vars) else pd.DataFrame()
        
        # Convert to dict format
        mean_corr = mean_corr.round(4).to_dict() if len(mean_vars) else {}
        fl = fl.round(4).to_dict() if len(mean_vars) else {}

    # Create visualizations - disabled for now to fix response issues
    plots = {}

    return {
        "ok": True,
        "excelPath": excel_path(),
        "rowCount": int(len(df)),
        "studentColumn": student_col,
        "constructs": constructs,                 # e.g., {"IN":["IN1","IN2"...], ...}
        "itemVariables": [],                     # No individual variables needed
        "meanVariables": section_means,          # Only M1, M2, M3, M4, M5
        "numericVariables": candidates,           # Only M1, M2, M3, M4, M5 for dropdown
        "variables": candidates,                  # Only M1, M2, M3, M4, M5
        "candidateVariables": candidates,        # Only M1, M2, M3, M4, M5
        "cronbachAlpha": alphas,                  # {"IN":0.88, ...}
        "ave": ave,                               # {"IN":0.61, ...}
        "correlationMatrix": mean_corr,
        "fornellLarcker": fl,
        "visualizations": plots,                  # Base64 encoded plots
    }

def action_run(payload):
    """Run regression analysis; vizTypes null/all = complete results."""
    custom_excel_path = payload.get("excelPath")
    dependent = payload.get("dependent")
    independents = payload.get("independents", [])
    viz_types = payload.get("vizTypes", [])
    full_results = _viz_types_full(viz_types)

    df = load_df(custom_excel_path)
    df = normalize_numeric(df)

    constructs = detect_constructs(df)
    mean_vars = build_construct_means(df, constructs)

    all_vars = [dependent] + independents
    missing_vars = [var for var in all_vars if var not in df.columns]
    if missing_vars:
        return {
            "ok": False,
            "error": f"Variables not found in dataset: {missing_vars}",
            "availableVariables": list(df.columns),
        }

    selected_data = df[all_vars].dropna()
    if len(selected_data) < (len(independents) + 2):
        return {
            "ok": False,
            "error": f"Insufficient data for regression. Need at least {len(independents) + 2} rows, got {len(selected_data)}",
        }

    try:
        regression_results = run_regression(selected_data, dependent, independents)
    except Exception as e:
        print(f"Error in regression: {e}", file=sys.stderr)
        return {"ok": False, "error": f"Regression failed: {str(e)}"}

    alphas = {}
    for prefix, items in constructs.items():
        a = cronbach_alpha(df[items])
        alphas[prefix] = None if np.isnan(a) else float(a)

    ave = compute_ave(df, constructs)
    mean_corr = df[mean_vars].corr() if len(mean_vars) else pd.DataFrame()
    fl = fornell_larcker(mean_corr, ave) if len(mean_vars) else pd.DataFrame()

    plots = {}
    if full_results:
        plots = create_visualizations(
            df, constructs, mean_vars, mean_corr, regression_results, ave, dependent
        )
    elif viz_types:
        iviz = action_interactive_viz({
            "excelPath": custom_excel_path,
            "dependent": dependent,
            "independents": independents,
            "vizTypes": viz_types,
        })
        if iviz.get("ok"):
            plots = iviz.get("visualizations") or iviz.get("plots") or {}
            plots = {k: v for k, v in plots.items() if v}

    ui = _format_regression_ui(regression_results)
    return {
        "ok": regression_results.get("ok", False),
        "excelPath": custom_excel_path or excel_path(),
        "dependent": dependent,
        "independents": independents,
        "fullResults": full_results,
        "regression": regression_results,
        **ui,
        "cronbachAlpha": alphas,
        "ave": ave,
        "fornellLarcker": fl.round(4).to_dict() if len(mean_vars) else {},
        "correlationMatrix": mean_corr.round(4).to_dict() if len(mean_vars) else {},
        "visualizations": plots,
    }

def action_interactive_viz(payload):
    """Generate specific visualizations based on user selection"""
    custom_excel_path = payload.get("excelPath")
    dependent = payload.get("dependent")
    independents = payload.get("independents", [])
    viz_types = payload.get("vizTypes", [])  # Array of viz types user wants
    
    df = load_df(custom_excel_path)
    df = normalize_numeric(df)
    
    constructs = detect_constructs(df)
    mean_vars = build_construct_means(df, constructs)
    
    # Get selected variables
    all_vars = [dependent] + independents
    selected_data = df[all_vars].dropna()
    
    plots = {}
    
    # Generate only requested visualizations
    for viz_type in viz_types:
        try:
            vt = str(viz_type).lower()
            if vt == "histogram":
                plots["histogram"] = create_histogram(selected_data, all_vars)
            elif vt == "boxplot":
                plots["boxplot"] = create_boxplot(selected_data, all_vars)
            elif vt == "ppplot":
                plots["ppplot"] = create_ppplot(selected_data, all_vars)
            elif vt == "qqplot":
                plots["qqplot"] = create_qqplot(selected_data, all_vars)
            elif vt in ("regression", "scatter"):
                plots["regression"] = create_regression_plot(selected_data, dependent, independents)
            elif vt == "correlation":
                plots["correlation"] = create_correlation_heatmap(selected_data, all_vars)
            elif vt == "residuals":
                plots["residuals"] = create_regression_plot(selected_data, dependent, independents)
        except Exception as e:
            print(f"Error creating {viz_type}: {e}", file=sys.stderr)
    
    # Calculate summary statistics
    summary_stats = {}
    for var in all_vars:
        if var in selected_data.columns:
            summary_stats[var] = {
                "mean": float(selected_data[var].mean()),
                "median": float(selected_data[var].median()),
                "std": float(selected_data[var].std()),
                "min": float(selected_data[var].min()),
                "max": float(selected_data[var].max()),
                "count": int(selected_data[var].count())
            }
    
    # Run regression if requested
    regression_results = None
    if "regression" in viz_types or len(independents) > 0:
        try:
            regression_results = run_regression(selected_data, dependent, independents)
        except Exception as e:
            print(f"Error in regression: {e}", file=sys.stderr)
    
    return {
        "ok": True,
        "visualizations": plots,
        "plots": plots,
        "summaryStats": summary_stats,
        "regression": regression_results,
        "variables": all_vars,
        "dataShape": selected_data.shape,
        "interpretation": generate_interpretation(summary_stats, regression_results),
    }

def create_histogram(data, variables):
    """Create histogram for selected variables"""
    vars_ok = [v for v in variables if v in data.columns and data[v].notna().any()]
    if not vars_ok:
        return None

    n = len(vars_ok)
    ncols = min(2, n)
    nrows = int(np.ceil(n / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(6 * ncols, 4 * nrows))
    if n == 1:
        axes = np.array([axes])
    axes = np.atleast_1d(axes).flatten()
    colors = plt.cm.Set3(np.linspace(0, 1, n))

    for i, var in enumerate(vars_ok):
        axes[i].hist(data[var].dropna(), bins=20, color=colors[i], alpha=0.7, edgecolor="black")
        axes[i].set_title(f"Histogram of {var}", fontweight="bold")
        axes[i].set_xlabel(var)
        axes[i].set_ylabel("Frequency")
        axes[i].grid(True, alpha=0.3)

    for j in range(n, len(axes)):
        axes[j].set_visible(False)

    plt.tight_layout()
    buffer = io.BytesIO()
    plt.savefig(buffer, format="png", dpi=300, bbox_inches="tight")
    buffer.seek(0)
    plot_data = base64.b64encode(buffer.getvalue()).decode()
    plt.close(fig)
    return plot_data

def create_boxplot(data, variables):
    """Create box plot for selected variables"""
    plt.figure(figsize=(10, 6))
    
    # Prepare data for boxplot
    box_data = []
    labels = []
    
    for var in variables:
        if var in data.columns:
            box_data.append(data[var].dropna())
            labels.append(var)
    
    plt.boxplot(box_data, labels=labels, patch_artist=True)
    plt.title('Box Plot of Selected Variables', fontsize=16, fontweight='bold')
    plt.ylabel('Values')
    plt.xticks(rotation=45)
    plt.grid(True, alpha=0.3)
    
    # Add colors
    colors = plt.cm.Set3(np.linspace(0, 1, len(box_data)))
    for patch, color in zip(plt.gca().findobj(plt.matplotlib.patches.PathPatch), colors):
        patch.set_facecolor(color)
    
    plt.tight_layout()
    
    buffer = io.BytesIO()
    plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
    buffer.seek(0)
    plot_data = base64.b64encode(buffer.getvalue()).decode()
    plt.close()
    return plot_data

def create_ppplot(data, variables):
    """Create P-P style probability plots for selected variables."""
    vars_ok = [v for v in variables if v in data.columns and data[v].notna().sum() >= 3]
    if not vars_ok:
        return None
    n = len(vars_ok)
    ncols = min(2, n)
    nrows = int(np.ceil(n / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(6 * ncols, 4 * nrows))
    if n == 1:
        axes = np.array([axes])
    axes = np.atleast_1d(axes).flatten()
    for i, var in enumerate(vars_ok):
        stats.probplot(data[var].dropna(), dist="norm", plot=axes[i])
        axes[i].set_title(f"P-P Plot: {var}", fontweight="bold")
        axes[i].grid(True, alpha=0.3)
    for j in range(n, len(axes)):
        axes[j].set_visible(False)
    plt.tight_layout()
    buffer = io.BytesIO()
    plt.savefig(buffer, format="png", dpi=200, bbox_inches="tight")
    buffer.seek(0)
    plot_data = base64.b64encode(buffer.getvalue()).decode()
    plt.close(fig)
    return plot_data


def create_qqplot(data, variables):
    """Create Q-Q plots (normality check) for selected variables."""
    vars_ok = [v for v in variables if v in data.columns and data[v].notna().sum() >= 3]
    if not vars_ok:
        return None
    n = len(vars_ok)
    ncols = min(2, n)
    nrows = int(np.ceil(n / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(6 * ncols, 4 * nrows))
    if n == 1:
        axes = np.array([axes])
    axes = np.atleast_1d(axes).flatten()
    for i, var in enumerate(vars_ok):
        sample = data[var].dropna()
        stats.probplot(sample, dist="norm", plot=axes[i])
        axes[i].set_title(f"Q-Q Plot: {var}", fontweight="bold")
        axes[i].set_xlabel("Theoretical Quantiles")
        axes[i].set_ylabel("Ordered Values")
        axes[i].grid(True, alpha=0.3)
    for j in range(n, len(axes)):
        axes[j].set_visible(False)
    plt.tight_layout()
    buffer = io.BytesIO()
    plt.savefig(buffer, format="png", dpi=200, bbox_inches="tight")
    buffer.seek(0)
    plot_data = base64.b64encode(buffer.getvalue()).decode()
    plt.close(fig)
    return plot_data

def create_regression_plot(data, dependent, independents):
    """Create regression plot"""
    if len(independents) != 1:
        return None  # Only for simple linear regression
    
    x_var = independents[0]
    y_var = dependent
    
    if x_var not in data.columns or y_var not in data.columns:
        return None
    
    plt.figure(figsize=(10, 6))
    
    # Scatter plot
    plt.scatter(data[x_var], data[y_var], alpha=0.6, color='blue', label='Data points')
    
    # Fit regression line
    from sklearn.linear_model import LinearRegression
    X = data[[x_var]].dropna()
    y = data[y_var].loc[X.index]
    
    model = LinearRegression()
    model.fit(X, y)
    
    # Plot regression line
    x_line = np.linspace(X.min(), X.max(), 100)
    y_line = model.predict(x_line.reshape(-1, 1))
    plt.plot(x_line, y_line, 'r-', linewidth=2, label=f'Regression line (R² = {model.score(X, y):.3f})')
    
    plt.xlabel(x_var)
    plt.ylabel(y_var)
    plt.title(f'Regression: {y_var} vs {x_var}', fontsize=14, fontweight='bold')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    plt.tight_layout()
    
    buffer = io.BytesIO()
    plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
    buffer.seek(0)
    plot_data = base64.b64encode(buffer.getvalue()).decode()
    plt.close()
    return plot_data

def create_correlation_heatmap(data, variables):
    """Create correlation heatmap"""
    # Filter to only numeric variables
    numeric_vars = [var for var in variables if var in data.columns and pd.api.types.is_numeric_dtype(data[var])]
    
    if len(numeric_vars) < 2:
        return None
    
    corr_matrix = data[numeric_vars].corr()
    
    plt.figure(figsize=(10, 8))
    sns.heatmap(corr_matrix, annot=True, cmap='coolwarm', center=0, 
                square=True, linewidths=0.5, fmt='.2f')
    plt.title('Correlation Heatmap', fontsize=16, fontweight='bold')
    plt.tight_layout()
    
    buffer = io.BytesIO()
    plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
    buffer.seek(0)
    plot_data = base64.b64encode(buffer.getvalue()).decode()
    plt.close()
    return plot_data

def generate_interpretation(summary_stats, regression_results):
    """Generate simple interpretation of results"""
    interpretation = []
    
    # Interpret summary statistics
    for var, stats in summary_stats.items():
        interpretation.append(f"📊 {var}: Mean = {stats['mean']:.2f}, Std = {stats['std']:.2f}")
    
    # Interpret regression results
    if regression_results and regression_results.get("ok"):
        r_squared = regression_results.get("r_squared", 0)
        interpretation.append(f"📈 Model explains {r_squared*100:.1f}% of the variance in the dependent variable")
        
        if r_squared > 0.7:
            interpretation.append("✅ Strong model fit")
        elif r_squared > 0.5:
            interpretation.append("🟡 Moderate model fit")
        else:
            interpretation.append("⚠️ Weak model fit")
    
    return interpretation

def main():
    payload = read_payload()
    action = payload.get("action")

    try:
        if action == "get-variables":
            result = action_get_variables(payload)
            print(json.dumps(result))
            return

        if action == "metadata":
            result = action_metadata(payload)
            print(json.dumps(result))
            return

        if action == "run":
            result = action_run(payload)
            print(json.dumps(result))
            return

        if action == "interactive_viz":
            result = action_interactive_viz(payload)
            print(json.dumps(result))
            return

        if action == "outlier_analysis":
            result = action_outlier_analysis(payload)
            print(json.dumps(result))
            return

        if action == "detect_type":
            result = action_detect_type(payload)
            print(json.dumps(result))
            return

        if action == "sales_aggregate":
            result = action_sales_aggregate(payload)
            print(json.dumps(result))
            return

        if action == "forecast":
            result = action_forecast(payload)
            print(json.dumps(result))
            return

        print(json.dumps({"ok": False, "error": "Unknown action"}))
    except Exception as e:
        import traceback
        error_details = {
            "ok": False, 
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        print(json.dumps(error_details))
        sys.exit(1)

if __name__ == "__main__":
    main()
