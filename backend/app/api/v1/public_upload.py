"""Public upload page for site officers.

Provides a shareable HTML page for uploading weekly reports and purchase orders.
"""

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from app.core.pool import fetch, fetchrow, execute
from app.monitoring.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


def _get_error_page(error_message: str) -> str:
    """Generate error page HTML."""
    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Upload Error - Plant Management</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }}
        .error-card {{
            background: white;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 400px;
            text-align: center;
        }}
        .error-icon {{
            font-size: 64px;
            margin-bottom: 20px;
        }}
        h1 {{
            color: #dc3545;
            margin-bottom: 16px;
        }}
        p {{
            color: #666;
            line-height: 1.6;
        }}
    </style>
</head>
<body>
    <div class="error-card">
        <div class="error-icon">&#9888;</div>
        <h1>Access Denied</h1>
        <p>{error_message}</p>
    </div>
</body>
</html>
"""


def _get_upload_page(token_info: dict) -> str:
    """Generate upload form HTML."""
    location_name = token_info.get("location_name", "Any Location")
    token = token_info.get("token", "")
    allowed_types = token_info.get("allowed_upload_types", ["weekly_report", "purchase_order"])

    can_weekly = "weekly_report" in allowed_types
    can_po = "purchase_order" in allowed_types

    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Upload Reports - Plant Management</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }}
        .container {{
            max-width: 600px;
            margin: 0 auto;
        }}
        .card {{
            background: white;
            padding: 32px;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            margin-bottom: 20px;
        }}
        h1 {{
            color: #333;
            margin-bottom: 8px;
            font-size: 24px;
        }}
        .subtitle {{
            color: #666;
            margin-bottom: 24px;
            font-size: 14px;
        }}
        .location-badge {{
            display: inline-block;
            background: #e3f2fd;
            color: #1976d2;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 24px;
        }}
        .tabs {{
            display: flex;
            gap: 8px;
            margin-bottom: 24px;
        }}
        .tab {{
            flex: 1;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            background: white;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
        }}
        .tab:hover {{
            border-color: #667eea;
        }}
        .tab.active {{
            background: #667eea;
            color: white;
            border-color: #667eea;
        }}
        .tab:disabled {{
            opacity: 0.5;
            cursor: not-allowed;
        }}
        .form-group {{
            margin-bottom: 20px;
        }}
        label {{
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
            color: #333;
            font-size: 14px;
        }}
        input, select {{
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.2s;
        }}
        input:focus, select:focus {{
            outline: none;
            border-color: #667eea;
        }}
        .file-input {{
            border: 2px dashed #e0e0e0;
            border-radius: 8px;
            padding: 40px 20px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
        }}
        .file-input:hover {{
            border-color: #667eea;
            background: #f8f9ff;
        }}
        .file-input.has-file {{
            border-color: #4caf50;
            background: #e8f5e9;
        }}
        .file-input input {{
            display: none;
        }}
        .file-icon {{
            font-size: 48px;
            margin-bottom: 12px;
        }}
        .file-text {{
            color: #666;
        }}
        .file-name {{
            color: #333;
            font-weight: 500;
            margin-top: 8px;
        }}
        .btn {{
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }}
        .btn:hover {{
            transform: translateY(-2px);
            box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
        }}
        .btn:disabled {{
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }}
        .status {{
            margin-top: 20px;
            padding: 16px;
            border-radius: 8px;
            display: none;
        }}
        .status.success {{
            background: #e8f5e9;
            color: #2e7d32;
            display: block;
        }}
        .status.error {{
            background: #ffebee;
            color: #c62828;
            display: block;
        }}
        .status.processing {{
            background: #e3f2fd;
            color: #1565c0;
            display: block;
        }}
        .hidden {{
            display: none;
        }}
        .help-text {{
            font-size: 12px;
            color: #888;
            margin-top: 4px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>Upload Report</h1>
            <p class="subtitle">Submit your weekly reports or purchase order documents</p>
            <div class="location-badge">&#128205; {location_name}</div>

            <div class="tabs">
                <button class="tab {'active' if can_weekly else ''}" id="tab-weekly" onclick="switchTab('weekly')" {'disabled' if not can_weekly else ''}>
                    Weekly Report
                </button>
                <button class="tab {'active' if not can_weekly and can_po else ''}" id="tab-po" onclick="switchTab('po')" {'disabled' if not can_po else ''}>
                    Purchase Order
                </button>
            </div>

            <!-- Weekly Report Form -->
            <form id="form-weekly" class="{'hidden' if not can_weekly else ''}" onsubmit="submitWeeklyReport(event)">
                <input type="hidden" name="token" value="{token}">

                <div class="form-group">
                    <label>Week Ending Date *</label>
                    <input type="date" name="week_ending_date" required>
                </div>

                <div class="form-group">
                    <label>Your Name</label>
                    <input type="text" name="submitter_name" placeholder="e.g., John Doe">
                </div>

                <div class="form-group">
                    <label>Your Email</label>
                    <input type="email" name="submitter_email" placeholder="e.g., john@example.com">
                </div>

                <div class="form-group">
                    <label>Excel File *</label>
                    <div class="file-input" id="weekly-file-drop" onclick="document.getElementById('weekly-file').click()">
                        <div class="file-icon">&#128196;</div>
                        <div class="file-text">Click or drag to upload Excel file</div>
                        <div class="file-name" id="weekly-file-name"></div>
                        <input type="file" id="weekly-file" name="file" accept=".xlsx,.xls" required onchange="fileSelected(this, 'weekly')">
                    </div>
                    <p class="help-text">Accepts .xlsx and .xls files</p>
                </div>

                <button type="submit" class="btn" id="weekly-submit">Upload Weekly Report</button>
            </form>

            <!-- Purchase Order Form -->
            <form id="form-po" class="{'hidden' if can_weekly else ''}" onsubmit="submitPurchaseOrder(event)">
                <input type="hidden" name="token" value="{token}">

                <div class="form-group">
                    <label>PO Number</label>
                    <input type="text" name="po_number" placeholder="e.g., PO-2024-001">
                </div>

                <div class="form-group">
                    <label>PO Date</label>
                    <input type="date" name="po_date">
                </div>

                <div class="form-group">
                    <label>Your Name</label>
                    <input type="text" name="submitter_name" placeholder="e.g., John Doe">
                </div>

                <div class="form-group">
                    <label>Your Email</label>
                    <input type="email" name="submitter_email" placeholder="e.g., john@example.com">
                </div>

                <div class="form-group">
                    <label>Document *</label>
                    <div class="file-input" id="po-file-drop" onclick="document.getElementById('po-file').click()">
                        <div class="file-icon">&#128196;</div>
                        <div class="file-text">Click or drag to upload document</div>
                        <div class="file-name" id="po-file-name"></div>
                        <input type="file" id="po-file" name="file" accept=".xlsx,.xls,.pdf,.jpg,.jpeg,.png" required onchange="fileSelected(this, 'po')">
                    </div>
                    <p class="help-text">Accepts Excel, PDF, or image files</p>
                </div>

                <button type="submit" class="btn" id="po-submit">Upload Purchase Order</button>
            </form>

            <div class="status" id="status"></div>
        </div>
    </div>

    <script>
        const API_BASE = window.location.origin + '/api/v1';

        function switchTab(tab) {{
            document.getElementById('tab-weekly').classList.toggle('active', tab === 'weekly');
            document.getElementById('tab-po').classList.toggle('active', tab === 'po');
            document.getElementById('form-weekly').classList.toggle('hidden', tab !== 'weekly');
            document.getElementById('form-po').classList.toggle('hidden', tab !== 'po');
            document.getElementById('status').className = 'status';
        }}

        function fileSelected(input, type) {{
            const nameEl = document.getElementById(type + '-file-name');
            const dropEl = document.getElementById(type + '-file-drop');

            if (input.files.length > 0) {{
                nameEl.textContent = input.files[0].name;
                dropEl.classList.add('has-file');
            }} else {{
                nameEl.textContent = '';
                dropEl.classList.remove('has-file');
            }}
        }}

        function showStatus(message, type) {{
            const el = document.getElementById('status');
            el.textContent = message;
            el.className = 'status ' + type;
        }}

        async function submitWeeklyReport(e) {{
            e.preventDefault();
            const form = e.target;
            const btn = document.getElementById('weekly-submit');

            btn.disabled = true;
            btn.textContent = 'Uploading...';
            showStatus('Uploading file...', 'processing');

            try {{
                const formData = new FormData(form);
                const response = await fetch(API_BASE + '/uploads/weekly-report', {{
                    method: 'POST',
                    body: formData,
                }});

                const data = await response.json();

                if (data.success) {{
                    showStatus('Upload successful! Your report is being processed. Job ID: ' + data.job_id, 'success');
                    form.reset();
                    document.getElementById('weekly-file-name').textContent = '';
                    document.getElementById('weekly-file-drop').classList.remove('has-file');
                }} else {{
                    showStatus('Error: ' + (data.detail || data.message || 'Upload failed'), 'error');
                }}
            }} catch (err) {{
                showStatus('Error: ' + err.message, 'error');
            }} finally {{
                btn.disabled = false;
                btn.textContent = 'Upload Weekly Report';
            }}
        }}

        async function submitPurchaseOrder(e) {{
            e.preventDefault();
            const form = e.target;
            const btn = document.getElementById('po-submit');

            btn.disabled = true;
            btn.textContent = 'Uploading...';
            showStatus('Uploading file...', 'processing');

            try {{
                const formData = new FormData(form);
                const response = await fetch(API_BASE + '/uploads/purchase-order', {{
                    method: 'POST',
                    body: formData,
                }});

                const data = await response.json();

                if (data.success) {{
                    showStatus('Upload successful! Your document is being processed. Job ID: ' + data.job_id, 'success');
                    form.reset();
                    document.getElementById('po-file-name').textContent = '';
                    document.getElementById('po-file-drop').classList.remove('has-file');
                }} else {{
                    showStatus('Error: ' + (data.detail || data.message || 'Upload failed'), 'error');
                }}
            }} catch (err) {{
                showStatus('Error: ' + err.message, 'error');
            }} finally {{
                btn.disabled = false;
                btn.textContent = 'Upload Purchase Order';
            }}
        }}

        // Enable drag and drop
        ['weekly', 'po'].forEach(type => {{
            const dropEl = document.getElementById(type + '-file-drop');
            const fileInput = document.getElementById(type + '-file');

            dropEl.addEventListener('dragover', (e) => {{
                e.preventDefault();
                dropEl.style.borderColor = '#667eea';
                dropEl.style.background = '#f8f9ff';
            }});

            dropEl.addEventListener('dragleave', (e) => {{
                e.preventDefault();
                dropEl.style.borderColor = '';
                dropEl.style.background = '';
            }});

            dropEl.addEventListener('drop', (e) => {{
                e.preventDefault();
                dropEl.style.borderColor = '';
                dropEl.style.background = '';

                if (e.dataTransfer.files.length > 0) {{
                    fileInput.files = e.dataTransfer.files;
                    fileSelected(fileInput, type);
                }}
            }});
        }});
    </script>
</body>
</html>
"""


@router.get("/upload", response_class=HTMLResponse)
async def upload_page(
    token: str = Query(..., description="Upload token/passcode"),
) -> HTMLResponse:
    """Serve the public upload page.

    This is a shareable page that site officers can use to upload
    weekly reports and purchase order documents.

    Args:
        token: The upload token for authentication.

    Returns:
        HTML page with upload form.
    """
    # Validate token with LEFT JOIN for location name
    rows = await fetch(
        """SELECT ut.*, l.name AS location_name
           FROM upload_tokens ut
           LEFT JOIN locations l ON l.id = ut.location_id
           WHERE ut.token = $1 AND ut.is_active = true""",
        token,
    )

    if not rows:
        logger.warning("Invalid upload token attempt", token=token[:8] + "..." if len(token) > 8 else token)
        return HTMLResponse(
            content=_get_error_page("Invalid or expired upload token. Please contact your administrator for a valid link."),
            status_code=401,
        )

    token_data = rows[0]

    # Check expiration
    if token_data.get("expires_at"):
        from datetime import datetime, timezone
        expires_at = token_data["expires_at"]
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if expires_at < datetime.now(timezone.utc):
            logger.warning("Expired upload token attempt", token_id=token_data["id"])
            return HTMLResponse(
                content=_get_error_page("This upload link has expired. Please contact your administrator for a new link."),
                status_code=401,
            )

    # Build token info for page
    token_info = {
        "token": token,
        "location_name": token_data.get("location_name") or "Any Location",
        "allowed_upload_types": token_data.get("allowed_upload_types", ["weekly_report", "purchase_order"]),
    }

    logger.info(
        "Upload page accessed",
        token_id=token_data["id"],
        token_name=token_data.get("name"),
    )

    # Update last used
    await execute(
        "UPDATE upload_tokens SET last_used_at = now(), use_count = $2 WHERE id = $1::uuid",
        token_data["id"],
        (token_data.get("use_count") or 0) + 1,
    )

    return HTMLResponse(content=_get_upload_page(token_info))
