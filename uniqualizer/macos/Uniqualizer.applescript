-- Uniqualizer: перетащите видео на иконку приложения или откройте двойным щелчком.
on run
	set theFiles to choose file with prompt "Выберите видео для уникализации" with multiple selections allowed
	my processFiles(theFiles)
end run

on open theFiles
	my processFiles(theFiles)
end open

on processFiles(theFiles)
	set pathArgs to ""
	repeat with f in theFiles
		set pathArgs to pathArgs & " " & quoted form of POSIX path of f
	end repeat
	set homePath to POSIX path of (path to home folder)
	set outDir to homePath & "Movies/Uniq_Output"
	set lutDir to homePath & "Movies/Uniq_Output/luts"
	set py to quoted form of (POSIX path of (path to resource "uniq.py"))
	set envPath to "export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; "
	try
		display notification "Обработка запущена…" with title "Uniqualizer"
		do shell script envPath & "/usr/bin/python3 " & py & " run" & pathArgs & " -o " & quoted form of outDir & " --luts " & quoted form of lutDir & " --codec h264_videotoolbox >> " & quoted form of (homePath & "Library/Logs/uniqualizer.log") & " 2>&1"
		display notification "Готово. Папка: Movies/Uniq_Output" with title "Uniqualizer"
		do shell script "open " & quoted form of outDir
	on error errMsg
		display dialog "Ошибка: " & errMsg & return & "Лог: ~/Library/Logs/uniqualizer.log" buttons {"OK"}
	end try
end processFiles
