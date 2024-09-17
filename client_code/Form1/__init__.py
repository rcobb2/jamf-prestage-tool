from ._anvil_designer import Form1Template
from anvil import *
import anvil.server


class Form1(Form1Template):
  def __init__(self, **properties):
    # Set Form properties and Data Bindings.
    self.init_components(**properties)
    # Any code you write here will run before the form opens.
  
  def text_box_1_pressed_enter(self, **event_args):
    """This method is called when the user presses Enter in this text box"""
    #compName, compID, compSN, compAsset, prestageID, prestageName = anvil.server.call('get_target_computer', self.text_box_1.text)
    tokentest = anvil.server.call('get_target_computer', self.text_box_1.text)
    self.cName.text = f"{tokentest}"
    
    #self.cName.text = f"{compName}"
    #self.cSN.text = f"{compSN}"
    #self.cAsset.text = f"{compAsset}"
    #self.cID.text = f"{compID}"
    #self.pID.text = f"{prestageID}"
    #self.pName.text = f"{prestageName}"
    