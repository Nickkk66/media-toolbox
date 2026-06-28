; ===========================================================================
; installer.nsh — custom NSIS include for electron-builder (Video Compressor)
; ---------------------------------------------------------------------------
; Adds an OPTIONAL "local-AI models" page to the NSIS installer. The user picks
; which large model weights to set up; we DO NOT download anything inside NSIS
; (that would be fragile and would stall the installer on slow networks).
; Instead we record the choices to a tiny JSON file at $INSTDIR\ai-setup.json,
; and the app downloads the chosen models on its FIRST LAUNCH (see main.js,
; the maybeRunFirstRunSetup() block — it reads ai-setup.json from the install
; dir, downloads each selection with progress, then deletes the file).
;
; This file lives in the electron-builder buildResources dir (assets/), so it is
; auto-included as <buildResources>/installer.nsh — no nsis.include needed.
; We implement the documented hook:
;   - customPageAfterChangeDir : our nsDialogs page, shown right after the
;                                "choose install directory" page.
;
; NOTE: This page can ONLY be verified in a real built installer. It cannot be
; run in the dev environment. It is written defensively: a failure to write the
; JSON must never abort the install.
; ===========================================================================

; nsDialogs + LogicLib give us the dialog primitives and ${If}/${EndIf} etc.
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; --- Variables -------------------------------------------------------------
; Dialog handle + the two droplist (combobox) controls and their selections.
Var AiDialog
Var AiWhisperCombo      ; subtitles / speech-to-text model droplist
Var AiBgCombo           ; background-removal model droplist
Var AiWhisperChoice     ; resolved whisper model id ('' | tiny | base | small)
Var AiBgChoice          ; resolved bgremoval model id ('' | u2netp | u2net)

; ===========================================================================
; customPageAfterChangeDir — define the page (create + leave callbacks) and
; insert it into the wizard. electron-builder invokes this macro after the
; install-directory page, which is exactly where we want it.
; ===========================================================================
!macro customPageAfterChangeDir
  Page custom AiModelsPageCreate AiModelsPageLeave
!macroend

; ---------------------------------------------------------------------------
; AiModelsPageCreate — build the nsDialogs page.
; ---------------------------------------------------------------------------
Function AiModelsPageCreate
  ; Page header (title + subtitle in the wizard's top band).
  !insertmacro MUI_HEADER_TEXT "Optional local-AI models" \
    "Choose what to set up now — or skip and add them later."

  nsDialogs::Create 1018
  Pop $AiDialog
  ${If} $AiDialog == error
    Abort ; could not create the dialog — skip the page rather than break setup
  ${EndIf}

  ; --- Intro / explanation -------------------------------------------------
  ${NSD_CreateLabel} 0 0 100% 34u \
    "Optional local-AI models — you can also download these later in Settings \
> Local AI. Large models download on first launch (so this installer stays \
small and offline-friendly). Pick None to skip; nothing downloads now."

  ; --- Subtitles (speech-to-text / whisper) --------------------------------
  ${NSD_CreateLabel} 0 42u 100% 11u "Subtitles (speech-to-text)"
  ${NSD_CreateDropList} 0 54u 100% 13u ""
  Pop $AiWhisperCombo
  ; Order of items matters: index maps to a model id in AiModelsPageLeave.
  ${NSD_CB_AddString} $AiWhisperCombo "None (skip)"
  ${NSD_CB_AddString} $AiWhisperCombo "Tiny (~78 MB)"
  ${NSD_CB_AddString} $AiWhisperCombo "Base (~148 MB)"
  ${NSD_CB_AddString} $AiWhisperCombo "Small (~488 MB)"
  ${NSD_CB_SelectString} $AiWhisperCombo "None (skip)" ; default = None

  ; --- Background removal (rembg / U2-Net) ---------------------------------
  ${NSD_CreateLabel} 0 76u 100% 11u "Background removal"
  ${NSD_CreateDropList} 0 88u 100% 13u ""
  Pop $AiBgCombo
  ${NSD_CB_AddString} $AiBgCombo "None (skip)"
  ${NSD_CB_AddString} $AiBgCombo "Light (~4 MB)"
  ${NSD_CB_AddString} $AiBgCombo "Standard (~176 MB)"
  ${NSD_CB_SelectString} $AiBgCombo "None (skip)" ; default = None

  ${NSD_CreateLabel} 0 112u 100% 22u \
    "These run fully on your PC — no account, no cloud. You can change your \
selection anytime from Settings > Local AI inside the app."

  nsDialogs::Show
FunctionEnd

; ---------------------------------------------------------------------------
; AiModelsPageLeave — read the two droplists, map selections to model ids,
; and write $INSTDIR\ai-setup.json. Defensive: never aborts the install.
; ---------------------------------------------------------------------------
Function AiModelsPageLeave
  ; --- Map whisper selection (by index) to a model id ----------------------
  ; 0=None  1=Tiny  2=Base  3=Small
  ${NSD_CB_GetSelectedIndex} $AiWhisperCombo $0
  StrCpy $AiWhisperChoice "" ; default empty (None)
  ${If} $0 == 1
    StrCpy $AiWhisperChoice "tiny"
  ${ElseIf} $0 == 2
    StrCpy $AiWhisperChoice "base"
  ${ElseIf} $0 == 3
    StrCpy $AiWhisperChoice "small"
  ${EndIf}

  ; --- Map background-removal selection (by index) to a model id -----------
  ; 0=None  1=Light(u2netp)  2=Standard(u2net)
  ${NSD_CB_GetSelectedIndex} $AiBgCombo $1
  StrCpy $AiBgChoice "" ; default empty (None)
  ${If} $1 == 1
    StrCpy $AiBgChoice "u2netp"
  ${ElseIf} $1 == 2
    StrCpy $AiBgChoice "u2net"
  ${EndIf}

  ; --- If both are None, write nothing (no first-run work needed) ----------
  ${If} $AiWhisperChoice == ""
  ${AndIf} $AiBgChoice == ""
    Return
  ${EndIf}

  ; --- Build a minimal JSON object, omitting empty selections --------------
  ; e.g. {"whisper":"base","bgremoval":"u2netp"}  /  {"bgremoval":"u2netp"}
  StrCpy $9 "{" ; $9 accumulates the JSON body
  StrCpy $8 ""  ; $8 tracks whether we've written a field yet (for the comma)

  ${If} $AiWhisperChoice != ""
    StrCpy $9 '$9"whisper":"$AiWhisperChoice"'
    StrCpy $8 "1"
  ${EndIf}

  ${If} $AiBgChoice != ""
    ${If} $8 == "1"
      StrCpy $9 "$9," ; separator after a previous field
    ${EndIf}
    StrCpy $9 '$9"bgremoval":"$AiBgChoice"'
  ${EndIf}

  StrCpy $9 "$9}"

  ; --- Write the file. Any failure is swallowed (don't fail the install) ---
  ; $INSTDIR is the user-chosen install directory; at runtime the app maps the
  ; same location via path.dirname(app.getPath('exe')).
  ClearErrors
  FileOpen $7 "$INSTDIR\ai-setup.json" w
  IfErrors aiWriteDone ; couldn't open — silently skip
  FileWrite $7 "$9"
  FileClose $7
aiWriteDone:
  ClearErrors
FunctionEnd
