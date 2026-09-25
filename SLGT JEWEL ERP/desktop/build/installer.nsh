; Custom NSIS script — runs as admin during install/uninstall.
; Adds a Windows Firewall inbound rule so staff PCs can reach
; the owner PC's backend on port 8080 over the local network.

!macro customInstall
  DetailPrint "Configuring Windows Firewall for LAN access..."
  ; Remove any old/duplicate rule first (including old port 8000 rules), then add a clean one.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Jewellery ERP LAN Port 8000"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Jewellery ERP LAN Port 8080"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Jewellery ERP LAN Port 8080" protocol=TCP dir=in localport=8080 action=allow profile=any'
  DetailPrint "Firewall rule added — staff PCs can now connect on port 8080."
!macroend

!macro customUnInstall
  DetailPrint "Removing Windows Firewall rule..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Jewellery ERP LAN Port 8080"'
!macroend
