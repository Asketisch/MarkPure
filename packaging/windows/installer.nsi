; MarkPure NSIS Installer Script
; Requires NSIS 3.x

!include "MUI2.nsh"

; General
Name "MarkPure"
OutFile "MarkPure-Setup.exe"
InstallDir "$PROGRAMFILES64\MarkPure"
InstallDirRegKey HKLM "Software\MarkPure" "InstallDir"
RequestExecutionLevel admin

; Interface Settings
!define MUI_ABORTWARNING
!define MUI_ICON "..\..\assets\icons\icon.ico"
!define MUI_UNICON "..\..\assets\icons\icon.ico"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Languages
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

; Installer Section
Section "Install"
    SetOutPath "$INSTDIR"

    ; Copy files
    File /r "..\..\target\release\markpure.exe"

    ; Write registry keys
    WriteRegStr HKLM "Software\MarkPure" "InstallDir" "$INSTDIR"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPure" "DisplayName" "MarkPure"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPure" "UninstallString" '"$INSTDIR\uninstall.exe"'
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPure" "DisplayIcon" "$INSTDIR\markpure.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPure" "Publisher" "MarkPure"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPure" "DisplayVersion" "0.1.0"

    ; Create uninstaller
    WriteUninstaller "$INSTDIR\uninstall.exe"

    ; Create Start Menu shortcuts
    CreateDirectory "$SMPROGRAMS\MarkPure"
    CreateShortCut "$SMPROGRAMS\MarkPure\MarkPure.lnk" "$INSTDIR\markpure.exe"
    CreateShortCut "$SMPROGRAMS\MarkPure\Uninstall.lnk" "$INSTDIR\uninstall.exe"

    ; Create Desktop shortcut
    CreateShortCut "$DESKTOP\MarkPure.lnk" "$INSTDIR\markpure.exe"
SectionEnd

; Uninstaller Section
Section "Uninstall"
    ; Remove files
    Delete "$INSTDIR\markpure.exe"
    Delete "$INSTDIR\uninstall.exe"

    ; Remove directory
    RMDir /r "$INSTDIR"

    ; Remove registry keys
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPure"
    DeleteRegKey HKLM "Software\MarkPure"

    ; Remove shortcuts
    Delete "$SMPROGRAMS\MarkPure\*.*"
    RMDir "$SMPROGRAMS\MarkPure"
    Delete "$DESKTOP\MarkPure.lnk"
SectionEnd
