function rfs()
{
    chrome.runtime.sendMessage({ action: "stat" }, function(data)
    {
        if (data == null)
        {
            console.log("callback get error", chrome.runtime.lastError);
            return;
        }
        console.log(data);
        var objtab = $("#stat");
        objtab.empty();
        Object.keys(data).forEach((name) =>
        {
            var row = "<tr><td width='40%'>" + name + "</td><td>" + data[name] + "</td></tr>";
            objtab.append(row);
        });
    });
}

$(document).on("click", "button#rfs", rfs);
$(document).on("click", "button.openpage", e =>
{
    const dest = e.target.dataset.htmlname;
    chrome.runtime.sendMessage({ action: "openpage", isBackground: false, target: dest+".html" });
});
$(document).ready(() =>
{
    //rfs();
});
