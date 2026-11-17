$c = Get-Content 'C:\Users\luosh\IdeaProjects\SkillMate\src\locales\zh-CN.js' -Raw
foreach ($k in @('install.action.enable','install.title.add','preview.checkUpdate','skills.detailClose','common.install','market.title','updates.checkAll')) {
  $pattern = '"' + [regex]::Escape($k) + '":\s*"([^"]+)"'
  $m = [regex]::Match($c, $pattern)
  Write-Output ($k + ' = ' + $m.Groups[1].Value)
}
