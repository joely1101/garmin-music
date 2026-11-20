param(
    [string]$Action,
    [string]$DeviceName = "",
    [string]$SubPath = "",
    [string]$SourceFile = "",
    [string]$FileName = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-MTPDevices {
    $shell = New-Object -ComObject Shell.Application
    $pc = $shell.NameSpace(17)
    $devices = @()

    foreach ($item in $pc.Items()) {
        $isDrive = $item.Path -match '^[A-Za-z]:\\'
        if (-not $isDrive) {
            $f = $null
            try { $f = $item.GetFolder } catch {}
            if ($f -ne $null -or $item.IsFolder) {
                $devices += [PSCustomObject]@{
                    name   = $item.Name
                    path   = "mtp:\" + $item.Name
                    label  = $item.Name + " (MTP 裝置)"
                    is_mtp = $true
                }
            }
        }
    }
    return $devices
}

function Get-MTPFolderItem {
    param([string]$DevName, [string]$RelPath)
    $shell = New-Object -ComObject Shell.Application
    $pc = $shell.NameSpace(17)
    $device = $pc.Items() | Where-Object { $_.Name.Trim() -eq $DevName.Trim() } | Select-Object -First 1
    if (!$device) {
        $device = $pc.Items() | Where-Object { $_.Name -like "*$DevName*" } | Select-Object -First 1
    }
    if (!$device) { return $null }

    $folder = $null
    try { $folder = $device.GetFolder } catch {}
    if (!$folder) { return $null }

    if (!$RelPath -or $RelPath.Trim() -eq "") {
        return $folder
    }

    $parts = $RelPath.Trim('\').Split('\')
    foreach ($part in $parts) {
        if (!$part) { continue }
        $child = $folder.Items() | Where-Object { $_.Name.Trim() -eq $part.Trim() } | Select-Object -First 1
        if (!$child) { return $null }
        $folder = $child.GetFolder
    }
    return $folder
}

function List-MTPSubfolders {
    param([string]$DevName, [string]$RelPath)
    $folder = Get-MTPFolderItem -DevName $DevName -RelPath $RelPath
    if (!$folder) {
        return [PSCustomObject]@{ error = "找不到指定的 MTP 裝置或資料夾 ($DevName)" }
    }

    $subfolders = @()
    foreach ($item in $folder.Items()) {
        $f = $null
        try { $f = $item.GetFolder } catch {}
        if ($f -ne $null -or $item.IsFolder) {
            $childRel = if ($RelPath) { "$RelPath\$($item.Name)" } else { $item.Name }
            $subfolders += [PSCustomObject]@{
                name = $item.Name
                path = "mtp:\$DevName\$childRel"
            }
        }
    }

    $parentPath = $null
    if ($RelPath) {
        $parts = $RelPath.Trim('\').Split('\')
        if ($parts.Count -gt 1) {
            $parentRel = ($parts[0..($parts.Count - 2)]) -join '\'
            $parentPath = "mtp:\$DevName\$parentRel"
        } else {
            $parentPath = "mtp:\$DevName"
        }
    }

    $curPath = if ($RelPath) { "mtp:\$DevName\$RelPath" } else { "mtp:\$DevName" }

    return [PSCustomObject]@{
        current_path = $curPath
        parent_path  = $parentPath
        subfolders   = $subfolders
    }
}

function Copy-FileToMTP {
    param([string]$DevName, [string]$RelPath, [string]$SrcFile)
    $folder = Get-MTPFolderItem -DevName $DevName -RelPath $RelPath
    if (!$folder) {
        return [PSCustomObject]@{ success = $false; error = "找不到目標資料夾: $RelPath" }
    }
    try {
        $folder.CopyHere($SrcFile, 16 + 512)
        return [PSCustomObject]@{ success = $true }
    } catch {
        return [PSCustomObject]@{ success = $false; error = $_.Exception.Message }
    }
}

function Delete-FileFromMTP {
    param([string]$DevName, [string]$RelPath, [string]$FileName)
    $folder = Get-MTPFolderItem -DevName $DevName -RelPath $RelPath
    if (!$folder) {
        return [PSCustomObject]@{ success = $false; error = "找不到目標資料夾: $RelPath" }
    }
    $item = $folder.Items() | Where-Object { $_.Name -eq $FileName } | Select-Object -First 1
    if (!$item) {
        return [PSCustomObject]@{ success = $false; error = "找不到檔案: $FileName" }
    }
    try {
        $item.InvokeVerb("delete")
        return [PSCustomObject]@{ success = $true }
    } catch {
        return [PSCustomObject]@{ success = $false; error = $_.Exception.Message }
    }
}

function List-MTPFiles {
    param([string]$DevName, [string]$RelPath)
    $folder = Get-MTPFolderItem -DevName $DevName -RelPath $RelPath
    if (!$folder) {
        return @()
    }
    $files = @()
    foreach ($item in $folder.Items()) {
        if (!$item.IsFolder) {
            $files += [PSCustomObject]@{
                name = $item.Name
                size = $item.Size
                path = "mtp:\$DevName\$RelPath\$($item.Name)"
            }
        }
    }
    return $files
}

if ($Action -eq "list_devices") {
    $devs = Get-MTPDevices
    if ($devs -and $devs.Count -gt 0) {
        $devs | ConvertTo-Json -Compress
    } else {
        Write-Output "[]"
    }
}
elseif ($Action -eq "list_folders") {
    $res = List-MTPSubfolders -DevName $DeviceName -RelPath $SubPath
    if ($res) {
        $res | ConvertTo-Json -Compress
    } else {
        Write-Output "{}"
    }
}
elseif ($Action -eq "copy_file") {
    $res = Copy-FileToMTP -DevName $DeviceName -RelPath $SubPath -SrcFile $SourceFile
    $res | ConvertTo-Json -Compress
}
elseif ($Action -eq "delete_file") {
    $res = Delete-FileFromMTP -DevName $DeviceName -RelPath $SubPath -FileName $FileName
    $res | ConvertTo-Json -Compress
}
elseif ($Action -eq "list_files") {
    $res = List-MTPFiles -DevName $DeviceName -RelPath $SubPath
    if ($res -and $res.Count -gt 0) {
        $res | ConvertTo-Json -Compress
    } else {
        Write-Output "[]"
    }
}
