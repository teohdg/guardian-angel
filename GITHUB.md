# Push Guardian AI to GitHub

Your code is committed locally. Follow these steps to create a GitHub repo and upload.

## 1. Create the repository on GitHub

1. Go to [github.com/new](https://github.com/new)
2. **Repository name:** `guardian-ai` (or any name you like)
3. **Description:** Optional, e.g. "Proactive safety system - scheduled check-in calls with escalation"
4. Choose **Public**
5. **Do not** check "Add a README" or "Add .gitignore" (you already have them)
6. Click **Create repository**

## 2. Connect and push from your machine

In a terminal, from the project folder (`c:\Users\teohd\hackathon`):

```powershell
# Add GitHub as remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/guardian-ai.git

# Rename branch to main (GitHub default)
git branch -M main

# Push
git push -u origin main
```

If you used a different repo name than `guardian-ai`, use that in the URL instead.

## 3. If GitHub asks for login

- **HTTPS:** Use a [Personal Access Token](https://github.com/settings/tokens) as the password when prompted
- **SSH:** Use `git@github.com:YOUR_USERNAME/guardian-ai.git` as the remote URL if you have SSH keys set up

Done. Your code will be at `https://github.com/YOUR_USERNAME/guardian-ai`.
