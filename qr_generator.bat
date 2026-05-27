@echo off
python -m pip install qrcode --quiet
python "%~dp0qr_generator.py"
