You will need to set an a .env file for these secrets and settings - place these in the root directory of the project.

```env
# Azure MSAL Configuration
AZURE_CLIENT_ID=                                          # Entra Application Registration Client ID
AZURE_AUTHORITY=https://login.microsoftonline.com/        # Add your tenant ID after the slash or https://login.microsoftonline.com/common

# Client Configuration
CLIENT_HOSTNAME=                                          # Hostname you want for the client
CLIENT_PORT=                                              # Port you want for the client
THEME=                                                    # Default theme you want

# Server Configuration
SERVER_API_HOSTNAME=                                      # Hostname you want for the server
SERVER_API_PORT=                                          # Port you want for the server

# JAMF Instance and Credentials
JAMF_INSTANCE=                                            # Base JAMF URL e.g. https://constoso.jamfcloud.com
JAMF_CLIENT_ID=                                           # JAMF API Client ID
JAMF_CLIENT_SECRET=                                       # JAMF API Client Secret
```

JAMF API role privileges:
Update Mobile Device PreStage Enrollments, Read Computers, Read Mobile Device PreStage Enrollments, Assign Users to Mobile Devices, Read Inventory Preload Records, Read Computer Inventory Collection, Read Computer Inventory Collection Settings, Update Computers, Update Inventory Preload Records, Update User, Assign Users to Computers, Delete Mobile Device PreStage Enrollments, Read Computer Extension Attributes, Read Device Enrollment Program Instances, Read User, Delete Computer PreStage Enrollments, Create Inventory Preload Records, Read Computer Enrollment Invitations, Read Computer PreStage Enrollments, Update Computer PreStage Enrollments, Read Buildings.

You'll need to create a JAMF API Role that has these privileges, and then assign an API client to that role, That will give you the Client ID and Client Secret.

This project is a web app for JAMF Pro cloud and Entra ID that helps simplify and collate various menu's in JAMF to create a more streamlined experience managing MacOS devices regarding Prestage and Preload information.

Context:
In my environment, we utilize prestages to determine the device's use case (For us, Faculty/Staff, Classrooms, Labs, Loaner machines, and various test flows), but likely you might also have different prestages for different departments etc.
We also leverage the "Inventory Preload" feature to pre-fill information where we can such as (User, Asset Tag, Building, Room). This becomes helpful with Zero-Touch deployment workflows as for us:

We have scripts depending on the device's use case that set the computer's name and by extension the machines JAMF Record name to be CU (prefix) 12345 (asset tag) M (device type identifier - in this case M = Mac) or alternatively if the machine is assigned to a classroom/lab and not an individual user Test (building) 123 (room) - 12345 (asset tag) m (device type identifier).

This script is run upon enrollment completion (although you could do it directly in the prestage), meaning that we need this data "Preloaded" for it to pull from to populate the required variables to succesfully name a machine.

Before this tool, we would have to:

1. Go into the JAMF Pro portal
2. Go to computers -> PreStage Enrollments and assuming the device was not already assigned to a prestage, select the prestage you wish to assign the device to, then assign. One of the flaws in JAMF is that if a device is already assigned to a prestage it will not show in the available list of devices outside of the one it is currently assigned to causing our staff to have to go hunting for where the device was currently assigned.
3. Once the device is assigned to the correct prestage, we would have to fill out a csv template and upload it into JAMF to get the preload data in there.

We ran into a lot of issues with our staff forgetting to upload this information, or overwriting previously uploaded information unintentionally - along with it being a lot of clicks, pages, and menu's

This tool helps collate the most important information (atleast in our environment) and allows you to update those fields:

Once you've authenticated to your Entra ID environment to get access to the tool (I'm working on making this auth feature optional)

You can search for a computer utilizing the search box:
This uses the JAMF Classic API endpoint called JSSResource/computers/match

It _should_ find computers based on:

1. Name
2. Serial Number
3. Asset Tag
4. Mac Address
5. User

Jamf's Documentation claims:
"Name, mac address, etc. to filter by. Match uses the same format as the general search in Jamf Pro. For instance, admin\* can be used to match computer names that begin with admin"

It's worth noting explicitly that you can use wildcards (*) to help with your search
i.e. *12345* will return anything that has 12345 in it, 12345* = anything that starts with 12345, \*12345 = anything ending in 12345

If the search does not find any computer records, it will then load your device enrollment instances (Automated Device Enrollment / DEP) and then search for the serial number in those instances to find devices you have available to assign to prestage/preload that haven't been set up yet.

NOTE: Don't search beligerently with just a *, or something similarly (like *0\*) as this will return just about every record and will certainly fail the search, and possible lock up/down your JAMF Cloud server.

Once you've searched, it will return 2 sections:
Computer Details:
  ID: This is the computer's JAMF ID - it's largely unimportant, but if you've worked with the API it can be useful.
  Computer Name
  Computer Serial
  Last Run Prestage: This represents the prestage the machine was enrolled under last - this can differ from a currently assigned one, so I've displayed both here:
  Current Prestage: see above

Preload Details:
  Note: These reflect the values that are found in the preload record for the device (if found/present) with the exception of Asset Tag

  Username: Assigned user's username

  Email: The reason I've only included these fields instead of others is that depending on your directory service (LDAP, Entra, Google) these 2 fields should be enough to populate the other fields (Real name, department, phone number) if you use them.

  Asset Tag: NOTE: This field is populated from the inventory record, and not the preload entry

  Building: This will query your buildings set up in JAMF, and set the currently selected to the one in your preload record
  NOTE: It may be possible for a preload record to have a building not in JAMF - not sure how that would be handled here, but you should be able to set it to a proper building regardless.

  Room:
  At the bottom, there's a dropdown populated with the prestages in your environment.
  Note: You will need to remove from a currently assigned prestage prior to assigning to a new one - it will notify you if this occurs.

  Update Preload Information:
  This will attempt to update the preload record AND the current computer's inventory record allowing you to remediate devices with this tool if they've already been enrolled prior to the data being available, however, if a device hasn't been enrolled yet and you press this button, it will simply let you know that it was able to update the preload and not the inventory record.