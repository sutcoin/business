README - GitHub Pages + Google Apps Script integration
-----------------------------------------------------

Files:
- index.html   (client page; already wired to your Apps Script Web App URL)

Instructions:
1) Upload index.html to your GitHub repository root (or gh-pages branch) and enable GitHub Pages.
2) Open the page (https://<your>.github.io/<repo>/) and test the form:
   - Fill fields and attach 1-2 images (recommended max 2MB each)
   - Click 제출하기
3) On success the page shows Drive folder URL. Check your Google Drive > "업체 접수" folder.

Notes & tips:
- Apps Script Web App URL used: https://script.google.com/macros/s/AKfycbxiF5OfDy-SR0VAJdKhvKPxS-aKsaPfR81pd6qPjlz0ZpPtiISQ6syyuWa60PIlgrmyAw/exec
- If you see errors, open Developer Tools (Console and Network) and copy any error messages.
- If images fail frequently, reduce MAX_WIDTH or QUALITY in the script, or instruct submitters to use smaller images.
