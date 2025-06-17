# Jamf Prestage Tool

A lightweight tool to automate and customize the Jamf Prestage enrollment experience for your organization. This repository includes scripts and configuration files designed to simplify the enrollment process and brand it with your company's colors and logo.

## Requirements
- A Jamf Pro instance with appropriate administrative privileges.
- Basic knowledge of scripting & related tools (Bash, Javascript, Docker).
- Docker Desktop (or your favorite Docker client! You can even use the CLI 🥲)
- (Optional) Access to your company's logo and color codes for customization.

## Installation
1. Clone this repository or download its contents:
   ```bash
   git clone https://github.com/rcobb2/jamf-prestage-tool.git
   ```
2. Navigate to the project directory:
   ```bash
   cd jamf-prestage-tool
   ```
3. Add your own .env file, as shown below (see "Enviroment Variables" below)
4. Configure the JAMF API (see "JAMF Setup" below)

## Usage
1. Ensure your environment is properly configured.
2. Run the main script to initiate the automated process:
   ```bash
   docker compose up
   ```
3. Go to your cool new tool using https!

## Enviroment Variables
The following environment variables are used to configure the application. The values shown here are the defaults/examples and need to be changed.

The /common segment in the Azure AD authority URL (https://login.microsoftonline.com/common) allows users from any Azure AD tenant to sign in. This is useful for multi-tenant applications where users may belong to different organizations.

If you want to restrict sign-in to users from a specific Azure AD tenant, you can replace /common with your tenant's ID or domain name:

```env
# Azure MSAL Configuration
AZURE_CLIENT_ID=11111111-2222-3333-4444-555566667777           # Entra Application Registration Client ID

### Multi-tenant (any user):
AZURE_AUTHORITY=https://login.microsoftonline.com/common
### Single-tenant (specific organization):
AZURE_AUTHORITY=https://login.microsoftonline.com/tenant-id    # Replace with your Azure AD tenant's GUID or domain (e.g., contoso.microsoft.com).

# Client Configuration
CLIENT_HOSTNAME=localhost                                      # Hostname you want for the client
CLIENT_PORT=443                                                # Port you want for the client (If you change this, you'll likely need to change the CORS origin on server/server.ts)
THEME=dim                                                      # Default theme you want

# Server Configuration
SERVER_API_HOSTNAME=localhost                                  # Hostname you want for the server
SERVER_API_PORT=8443                                           # Port you want for the server

# JAMF Instance and Credentials
JAMF_INSTANCE=https://constoso.jamfcloud.com                   # Base JAMF URL e.g. https://constoso.jamfcloud.com
JAMF_CLIENT_ID=your_jamf_client_ID_here                        # JAMF API Client ID (example UUID)
JAMF_CLIENT_SECRET=your_jamf_client_secret_here                # JAMF API Client Secret
```

## JAMF Setup
Create an API role in Jamf Pro with the privileges listed below, then create a new API client and assign it to this role. This process will provide you with the Client ID and Client Secret needed for authentication.

JAMF API role privileges:
Update Static Computer Groups, Read Computer Security, Read Computers, Update Computer Security, Read Static Computer Groups, Read Re-enrollment, Update Computer Inventory Collection, View Local Admin Password Audit History, Update Computer Extension Attributes, Delete Computers, Read Computer Inventory Collection Settings, Update Computers, Update Smart Computer Groups, Update Computer Inventory Collection Settings, Update Local Admin Password Settings, Read Computer Enrollment Invitations, Read Computer PreStage Enrollments, Read Webhooks, Read User Extension Attributes, Update Smart User Groups, Read Computer Check-In, Read Static Mobile Device Groups, Read Static User Groups, Update Computer Enrollment Invitations, View Local Admin Password, Read Smart Computer Groups, Read Computer Inventory Collection, Update Smart Mobile Device Groups, Read Smart Mobile Device Groups, Update Computer Check-In, Read Computer Extension Attributes, Read Smart User Groups, Read Software Update Servers, Update Computer PreStage Enrollments

## Customization
1. **Logo & Branding**
   - Replace the default logo file in the cliennt folder with your company's logo (same file name or update references in scripts).
   - Add your own theme in the `client/styles.css` file to use your organization's colors.

2. **Scripts & Configurations**
   - Adjust any environment variables, API endpoints, or token values in the scripts to match your environment. This is expecially important if you want some other features to work (such as the 'Retire' button)
   - If desired, create custom hooks or additional scripts to integrate with your internal workflows (e.g., sending notifications after enrollment).

## Explanations & Details

### How We Use Prestages and Inventory Preload
In our environment, we use prestages to define a device's purpose (such as Faculty/Staff, Classrooms, Labs, Loaners, or test devices). You might have different prestages for departments or other categories. We also use the "Inventory Preload" feature to pre-fill details like User, Asset Tag, Building, and Room. This supports our Zero-Touch deployment workflows.

We have scripts that name devices based on their use case, using information like asset tag, device type, building, and room. These scripts run after enrollment and rely on preloaded data to set the correct computer name.

Previously, the process was manual and error-prone:
1. Assign the device to a prestage in the JAMF Pro portal.
2. If already assigned, search for its current prestage.
3. Upload a CSV with preload data.

Staff often forgot to upload or accidentally overwrote data, making the process slow and inconsistent.

This tool brings all the key information together in one place, making it easy to update fields as needed. After authenticating with Azure, you can quickly manage prestage assignments and preload data.

### Searching for a Computer
Use the search box to find a computer by name, serial number, asset tag, MAC address, or user. The tool uses the JAMF Classic API (`JSSResource/computers/match`), which supports wildcards (`*`). For example:

- `*12345*` finds anything containing `12345`
- `12345*` finds anything starting with `12345`
- `*12345` finds anything ending with `12345`

If no computer is found, the tool will check your Automated Device Enrollment (DEP) instances for the serial number.

**Tip:** Avoid broad searches like just `*` or `*0*`, as this can overload your JAMF server.

**Search results include:**
- **Computer Details:** JAMF ID, name, serial number
- **Last Run Prestage:** The prestage used during the last enrollment
- **Current Prestage:** The currently assigned prestage

### Preload Details
- **Username:** The assigned user's username from the preload record.
- **Email:** Only username and email are shown, since these can be used to fill in other fields (like real name or department) from your directory service (LDAP, Entra, Google).
- **Asset Tag:** Pulled from the inventory record, not the preload entry.
- **Building:** Shows the building from the preload record. If the building isn’t in JAMF, you can select a valid one.
- **Room:** Pulled from the preload record.

At the bottom, you’ll find a dropdown with your available prestages. To assign a new prestage, first remove the current one (the tool will notify you if needed).

**Update Preload Information:**
This updates both the preload and inventory records if the device is already enrolled. If not, only the preload record is updated and you’ll be notified.


## Support / Further Configuration
- Check the repository's [Issues](../../issues) for tips or existing discussions.
- Submit a pull request if you contribute improvements or new features.

## License
This project is licensed under the [GPL 3.0 license](LICENSE).