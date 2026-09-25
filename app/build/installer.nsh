; Установщик «Ye!Studio»: страница «Компоненты» и вопрос о скачанном при удалении.
; Сами программы и модель качает приложение при первом запуске (окно «Компоненты»): одна логика загрузки
; с докачкой и SHA256, а не её копия на NSIS. Здесь только галочки → install-options.json рядом с exe.
; Файл обязан быть UTF-8 с BOM: иначе NSIS искажает кириллицу.

!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
  Var CmpYtdlp
  Var CmpModel
  Var CmpYtdlpState
  Var CmpModelState

  !macro customPageAfterChangeDir
    Page custom CmpPageCreate CmpPageLeave
  !macroend

  Function CmpPageCreate
    !insertmacro MUI_HEADER_TEXT "Компоненты" "Что скачать при первом запуске"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 40u "ffmpeg (обрезка и перекодирование медиа, 110 МБ) скачается при первом запуске всегда. Остальное — по желанию: всё можно поставить или удалить позже в окне «Компоненты» (кнопка с пазлом в шапке)."
    Pop $0
    ${NSD_CreateCheckbox} 0 48u 100% 12u "Скачивание видео с YouTube, Rutube и по ссылкам (yt-dlp, 18 МБ)"
    Pop $CmpYtdlp
    ${If} $CmpYtdlpState == ""
    ${OrIf} $CmpYtdlpState == ${BST_CHECKED}
      ${NSD_Check} $CmpYtdlp
    ${EndIf}
    ${NSD_CreateCheckbox} 0 66u 100% 12u "Подобрать локальную модель картинок под эту видеокарту (6–13 ГБ, можно позже)"
    Pop $CmpModel
    ${If} $CmpModelState == ${BST_CHECKED}
      ${NSD_Check} $CmpModel
    ${EndIf}
    nsDialogs::Show
  FunctionEnd

  Function CmpPageLeave
    ${NSD_GetState} $CmpYtdlp $CmpYtdlpState
    ${NSD_GetState} $CmpModel $CmpModelState
  FunctionEnd

  !macro customInstall
    ; тихая установка (/S) страницу не показывает: yt-dlp по умолчанию ставим, модель — нет
    StrCpy $0 "true"
    ${If} $CmpYtdlpState == ${BST_UNCHECKED}
      StrCpy $0 "false"
    ${EndIf}
    StrCpy $1 "false"
    ${If} $CmpModelState == ${BST_CHECKED}
      StrCpy $1 "true"
    ${EndIf}
    FileOpen $2 "$INSTDIR\install-options.json" w
    FileWrite $2 '{"ytdlp": $0, "model": $1}'
    FileClose $2
  !macroend
!endif

!macro customUnInstall
  ; при обновлении старый деинсталлятор тоже запускается — тогда ничего не спрашиваем и не трогаем
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${Silent}
    ${If} ${FileExists} "$LOCALAPPDATA\Мастерская паков\components\*.*"
      MessageBox MB_YESNO|MB_ICONQUESTION "Удалить и скачанные компоненты (модель картинок, ffmpeg, yt-dlp)?$\r$\n$LOCALAPPDATA\Мастерская паков\components$\r$\n$\r$\nНастройки, ключи ИИ и паки останутся." IDNO cmp_keep
        RMDir /r "$LOCALAPPDATA\Мастерская паков\components"
      cmp_keep:
    ${EndIf}
  ${EndIf}
!macroend
